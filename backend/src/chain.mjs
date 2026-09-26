import {Connection,Keypair,PublicKey,TransactionMessage,VersionedTransaction,SystemProgram,SystemInstruction,ComputeBudgetProgram} from '@solana/web3.js';
import {PUMP_SDK,OnlinePumpSdk,getBuyTokenAmountFromSolAmount,creatorVaultPda,feeSharingConfigPda,canonicalPumpPoolPda} from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import {coinCreatorVaultAtaPda,coinCreatorVaultAuthorityPda} from '@pump-fun/pump-swap-sdk';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,createCloseAccountInstruction} from '@solana/spl-token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {need} from './errors.mjs';
import {sharingLaunchInstructions,assertSharing,sharingReceipt} from './fee-sharing.mjs';
import {decrypt} from './crypto.mjs';

export function readKey(value) {
 const bytes=value.startsWith('[')?Uint8Array.from(JSON.parse(value)):bs58.decode(value);
 return Keypair.fromSecretKey(bytes);
}
export function signedMatches(wire,message,wallet) {
 const tx=VersionedTransaction.deserialize(Buffer.from(wire,'base64'));
 need(Buffer.from(tx.message.serialize()).toString('base64')===message,400,'The transaction was changed. Review and prepare again');
 const index=tx.message.staticAccountKeys.findIndex(k=>k.toBase58()===wallet);
 need(index>=0&&index<tx.message.header.numRequiredSignatures,400,'Wallet is not a required signer');
 need(nacl.sign.detached.verify(tx.message.serialize(),tx.signatures[index],new PublicKey(wallet).toBytes()),401,'Wallet transaction signature is invalid');return tx;
}
export function chainService(config) {
 const connection=new Connection(config.rpcUrl||'http://127.0.0.1:8899',{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(15000)})});
 const sdk=new OnlinePumpSdk(connection);
 let checked=false;
 async function checkNetwork(){
  need(config.rpcUrl,503,'Solana RPC is awaiting configuration');
  if(checked)return;const genesis=await connection.getGenesisHash();
  const expected={'mainnet-beta':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d','devnet':'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'}[config.cluster];
  need(expected&&genesis===expected,503,'RPC network does not match the configured network');checked=true;
 }
 async function build(instructions,payer,signers=[],compact=false,lookupTables=[]) {
  await checkNetwork();const latest=await connection.getLatestBlockhash('confirmed');
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:latest.blockhash,instructions:compact?instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...instructions]}).compileToV0Message(lookupTables));
  if(signers.length)tx.sign(signers);
  let size;try{size=tx.serialize().length;}catch{need(false,422,'Launch transaction is too large. Shorten the token name and retry');}
  need(size<=1232,422,'Launch transaction is too large. Shorten the token name and retry');
  return {tx,lastValidHeight:latest.lastValidBlockHeight,wire:Buffer.from(tx.serialize()).toString('base64'),message:Buffer.from(tx.message.serialize()).toString('base64')};
 }
 return {
  connection,sdk,checkNetwork,
  async prepareLaunch({mint,creator,wallet,name,symbol,uri,initialBuy,encryptedMintSecret,feeTreasury}) {
   const args={mint:new PublicKey(mint),creator:new PublicKey(creator),user:new PublicKey(wallet),name,symbol,uri,mayhemMode:false,holderReward:false};
   await checkNetwork();
   need(Buffer.byteLength(name,'utf8')<=32,400,'Token name must fit within 32 UTF-8 bytes');
   let instructions;
   if(initialBuy>0n){
    const [global,feeConfig]=await Promise.all([sdk.fetchGlobal(),sdk.fetchFeeConfig()]);
    const solAmount=new BN(initialBuy.toString());
    // Null state marks a new curve and includes the creator fee in the quote.
    const amount=getBuyTokenAmountFromSolAmount({global,feeConfig,mintSupply:null,bondingCurve:null,amount:solAmount,quoteMint:PublicKey.default});
    need(amount.gtn(0),400,'Initial buy is too small');
    instructions=feeTreasury?await sharingLaunchInstructions(args,feeTreasury,global,amount,solAmount):await PUMP_SDK.createV2AndBuyInstructions({...args,global,solAmount,amount});
   }else instructions=feeTreasury?await sharingLaunchInstructions(args,feeTreasury):[await PUMP_SDK.createV2Instruction(args)];
   // Preserve the exact server-prepared message through external wallets. The mint
   // co-signature is present before Phantom signs, so the wallet cannot rewrite
   // the transaction without invalidating it. The payer still must approve/sign.
   const mintSigner=encryptedMintSecret?Keypair.fromSecretKey(decrypt(encryptedMintSecret,config.encryptionKey,`mint:${mint}`)):null;
   need(!mintSigner||mintSigner.publicKey.equals(args.mint),500,'Mint signer mismatch');
   const tables=[];if(feeTreasury){for(const address of config.launchLookupTables||[]){const {value}=await connection.getAddressLookupTable(new PublicKey(address));if(value?.isActive())tables.push(value);}need(tables.length,503,'Launch address lookup tables are unavailable');}
   const prepared=await build(instructions,args.user,mintSigner?[mintSigner]:[],!feeTreasury&&initialBuy>0n,tables);
   const simulation=await connection.simulateTransaction(prepared.tx,{sigVerify:false,commitment:'confirmed'});
   need(!simulation.value.err,422,'Launch simulation failed. Check your SOL balance for the buy, account rent and network fee, then retry');
   const fee=await connection.getFeeForMessage(prepared.tx.message,'confirmed');
   return {...prepared,networkFeeLamports:String(fee.value??0),simulationUnits:simulation.value.unitsConsumed??null};
  },
  async prepareBuy({mint,wallet,initialBuy}){
   await checkNetwork();const mintKey=new PublicKey(mint),user=new PublicKey(wallet);
   const [global,feeConfig,state]=await Promise.all([sdk.fetchGlobal(),sdk.fetchFeeConfig(),sdk.fetchBuyState(mintKey,user,TOKEN_2022_PROGRAM_ID)]);
   const solAmount=new BN(initialBuy.toString());
   const amount=getBuyTokenAmountFromSolAmount({global,feeConfig,mintSupply:global.tokenTotalSupply,bondingCurve:state.bondingCurve,amount:solAmount,quoteMint:PublicKey.default});
   const instructions=await PUMP_SDK.buyInstructions({global,...state,mint:mintKey,user,amount,solAmount,slippage:1,tokenProgram:TOKEN_2022_PROGRAM_ID});
   const prepared=await build(instructions,user);
   const simulation=await connection.simulateTransaction(prepared.tx,{sigVerify:false,commitment:'confirmed'});
   need(!simulation.value.err,422,'Initial buy simulation failed. Check your SOL balance and try again');return prepared;
  },
  async verifySharing(mint,treasury){
   const address=feeSharingConfigPda(new PublicKey(mint)),info=await connection.getAccountInfo(address,'finalized');
   need(info,409,'Fee sharing configuration is missing');const state=PUMP_SDK.decodeSharingConfig(info);assertSharing(state,mint,treasury);
   await this.verifyMint(mint,address.toBase58());return state;
  },
  async sharingCollection(mint,treasury,operator){
   await checkNetwork();const state=await this.verifySharing(mint,treasury),key=new PublicKey(mint),address=feeSharingConfigPda(key),instructions=[];
   if(await connection.getAccountInfo(canonicalPumpPoolPda(key)))instructions.push(await PUMP_SDK.transferCreatorFeesToPumpV2({payer:operator.publicKey,mint:key,quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID}));
   instructions.push(await PUMP_SDK.distributeCreatorFeesV2({mint:key,sharingConfig:state,sharingConfigAddress:address,quoteMint:NATIVE_MINT,payer:operator.publicKey,shouldInitializeAta:true,quoteTokenProgram:TOKEN_PROGRAM_ID}));
   return build(instructions,operator.publicKey,[operator]);
  },
  async sharingReceived(signature,mint,treasury){
   const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:1});need(tx,503,'Finalized fee receipt is unavailable');return {lamports:sharingReceipt(tx,mint,treasury),slot:tx.slot};
  },
  async collection(creator,operator){
   await checkNetwork();const instructions=await sdk.collectCoinCreatorFeeInstructions(creator.publicKey,operator.publicKey);
   const ata=getAssociatedTokenAddressSync(NATIVE_MINT,creator.publicKey);
   instructions.push(createCloseAccountInstruction(ata,creator.publicKey,creator.publicKey));
   return build(instructions,operator.publicKey,[creator,operator]);
  },
  async transfer(from,to,amount,operator){return build([SystemProgram.transfer({fromPubkey:from.publicKey,toPubkey:new PublicKey(to),lamports:BigInt(amount)})],operator.publicKey,[from,operator]);},
  transferDestination(wire){
   const tx=VersionedTransaction.deserialize(Buffer.from(wire,'base64'));
   const transfers=TransactionMessage.decompile(tx.message).instructions.filter(i=>i.programId.equals(SystemProgram.programId)).map(i=>SystemInstruction.decodeTransfer(i));
   need(transfers.length===1,500,'Unexpected stored transfer');return transfers[0].toPubkey.toBase58();
  },
  async send(wire){await checkNetwork();return connection.sendRawTransaction(Buffer.from(wire,'base64'),{skipPreflight:false,maxRetries:3});},
  async status(signature,lastValidHeight){
   await checkNetwork();const {value:[result]}=await connection.getSignatureStatuses([signature],{searchTransactionHistory:true});
   if(result?.confirmationStatus==='finalized'&&result.err)return {state:'failed',error:JSON.stringify(result.err)};
   // Financial allocations wait for finalization; do not credit on a reversible confirmation.
   if(result?.confirmationStatus==='finalized')return {state:'confirmed',slot:result.slot};
   if(result)return {state:'pending'};
   // A null result plus expired finalized blockheight means this blockhash can no longer land.
   const height=await connection.getBlockHeight('finalized');
   return {state:height>Number(lastValidHeight)?'expired':'pending'};
  },
  async verifyMint(mint,creator){const curve=await sdk.fetchBondingCurve(new PublicKey(mint));need(curve.creator.toBase58()===creator,409,'On-chain fee recipient does not match the launch');return curve;},
  async collectedFees(signature,creator){
   const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:1});
   need(tx&&!tx.meta?.err,503,'Finalized collection is not available');
   const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
   const native=creatorVaultPda(new PublicKey(creator)).toBase58();
   const ata=coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(new PublicKey(creator)),NATIVE_MINT,TOKEN_PROGRAM_ID).toBase58();
   let gross=0n;
   for(let i=0;i<keys.length;i++){
    if(keys.get(i)?.toBase58()===native){const a=tx.meta.preBalances[i],b=tx.meta.postBalances[i];need(Number.isSafeInteger(a)&&Number.isSafeInteger(b),503,'RPC amount exceeds exact integer range');if(a>b)gross+=BigInt(a)-BigInt(b);}
    if(keys.get(i)?.toBase58()===ata){const pre=tx.meta.preTokenBalances?.find(t=>t.accountIndex===i)?.uiTokenAmount.amount||'0';const post=tx.meta.postTokenBalances?.find(t=>t.accountIndex===i)?.uiTokenAmount.amount||'0';const delta=BigInt(pre)-BigInt(post);if(delta>0n)gross+=delta;}
   }
   return {lamports:gross,slot:tx.slot};
  },
  async receivedBy(signature,address){
   const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:1});
   need(tx&&!tx.meta?.err,503,'Finalized transaction is not available yet');
   const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
   let index=-1;for(let i=0;i<keys.length;i++)if(keys.get(i)?.toBase58()===address)index=i;
   need(index>=0,500,'Recipient missing from transaction');
   const before=tx.meta.preBalances[index],after=tx.meta.postBalances[index];
   need(Number.isSafeInteger(before)&&Number.isSafeInteger(after),503,'RPC balance exceeds exact JSON integer range');
   return {lamports:BigInt(after)-BigInt(before),slot:tx.slot};
  },
  async liabilityCoverage(treasury,liabilities){const balance=await connection.getBalance(new PublicKey(treasury),'finalized');need(Number.isSafeInteger(balance)&&BigInt(balance)>=liabilities,503,'Treasury reconciliation requires attention');return BigInt(balance);},
 };
}
