import {Connection,Keypair,PublicKey,TransactionMessage,VersionedTransaction,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {PUMP_SDK,OnlinePumpSdk,getBuyTokenAmountFromSolAmount,creatorVaultPda} from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import {coinCreatorVaultAtaPda,coinCreatorVaultAuthorityPda} from '@pump-fun/pump-swap-sdk';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,createCloseAccountInstruction} from '@solana/spl-token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {need} from './errors.mjs';

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
 async function build(instructions,payer,signers=[]) {
  await checkNetwork();const latest=await connection.getLatestBlockhash('confirmed');
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:latest.blockhash,instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:400000}),...instructions]}).compileToV0Message());
  if(signers.length)tx.sign(signers);
  return {tx,lastValidHeight:latest.lastValidBlockHeight,wire:Buffer.from(tx.serialize()).toString('base64'),message:Buffer.from(tx.message.serialize()).toString('base64')};
 }
 return {
  connection,sdk,checkNetwork,
  async prepareLaunch({mint,creator,wallet,name,symbol,uri,initialBuy}) {
   const args={mint:new PublicKey(mint),creator:new PublicKey(creator),user:new PublicKey(wallet),name,symbol,uri,mayhemMode:false,holderReward:false};
   let instructions;
   if(initialBuy>0n){
    await checkNetwork();const global=await sdk.fetchGlobal();const feeConfig=await sdk.fetchFeeConfig();
    const amount=getBuyTokenAmountFromSolAmount({global,feeConfig,mintSupply:null,bondingCurve:null,amount:new BN(initialBuy.toString()),quoteMint:PublicKey.default});
    instructions=await PUMP_SDK.createV2AndBuyInstructions({...args,global,amount,solAmount:new BN(initialBuy.toString())});
   }else instructions=[await PUMP_SDK.createV2Instruction(args)];
   const prepared=await build(instructions,args.user);
   const simulation=await connection.simulateTransaction(prepared.tx,{sigVerify:false,commitment:'confirmed'});
   need(!simulation.value.err,422,'Launch simulation failed. Check your wallet balance and try again');
   const fee=await connection.getFeeForMessage(prepared.tx.message,'confirmed');
   return {...prepared,networkFeeLamports:String(fee.value??0),simulationUnits:simulation.value.unitsConsumed??null};
  },
  async collection(creator,operator){
   await checkNetwork();const instructions=await sdk.collectCoinCreatorFeeInstructions(creator.publicKey,operator.publicKey);
   const ata=getAssociatedTokenAddressSync(NATIVE_MINT,creator.publicKey);
   instructions.push(createCloseAccountInstruction(ata,creator.publicKey,creator.publicKey));
   return build(instructions,operator.publicKey,[creator,operator]);
  },
  async transfer(from,to,amount,operator){return build([SystemProgram.transfer({fromPubkey:from.publicKey,toPubkey:new PublicKey(to),lamports:BigInt(amount)})],operator.publicKey,[from,operator]);},
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
  async verifyMint(mint,creator){const curve=await sdk.fetchBondingCurve(mint);need(curve.creator.toBase58()===creator,409,'On-chain fee recipient does not match the launch');return curve;},
  async collectedFees(signature,creator){
   const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
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
   const tx=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
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
