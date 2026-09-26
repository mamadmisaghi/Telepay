import {completeEventLogs} from './program-events.mjs';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {PUMP_SDK,PUMP_PROGRAM_ID,feeSharingConfigPda,creatorVaultPda} from '@pump-fun/pump-sdk';
import {NATIVE_MINT,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {need} from './errors.mjs';

export async function sharingLaunchInstructions(args,treasury,global,amount,solAmount){
 const {mint,user}=args,config=feeSharingConfigPda(mint);
 const base=solAmount?await PUMP_SDK.createV2AndBuyInstructions({...args,creator:user,global,amount,solAmount}):[await PUMP_SDK.createV2Instruction({...args,creator:user})];
 if(solAmount){
  // Use the official quote/buy builder, changing only the newly configured vault.
  const oldVault=creatorVaultPda(user),newVault=creatorVaultPda(config);
  for(const key of base.at(-1).keys)if(key.pubkey.equals(oldVault))key.pubkey=newVault;
 }
 return [base[0],await PUMP_SDK.createFeeSharingConfig({creator:user,mint,pool:null}),await PUMP_SDK.updateFeeSharesV2({authority:user,mint,currentShareholders:[user],newShareholders:[{address:new PublicKey(treasury),shareBps:10000}],quoteMint:NATIVE_MINT,quoteTokenProgram:TOKEN_PROGRAM_ID}),...base.slice(1)];
}
export function assertSharing(config,mint,treasury){
 need(config.mint.toBase58()===mint&&config.adminRevoked&&config.shareholders.length===1&&config.shareholders[0].address.toBase58()===treasury&&config.shareholders[0].shareBps===10000,409,'On-chain fee sharing does not match the locked TelePaid allocation');
}
const disc=createHash('sha256').update('event:DistributeCreatorFeesEvent').digest().subarray(0,8);
export function sharingReceipt(tx,mint,treasury,decoder=PUMP_SDK){
 if(!tx?.meta||tx.meta.err)return 0n;
 const stack=[];let amount=0n;
 for(const line of completeEventLogs(tx)){
  const invoke=/^Program (\w+) invoke \[(\d+)\]$/.exec(line);
  if(invoke){stack.length=Number(invoke[2])-1;stack.push(invoke[1]);continue;}
  if(/^Program \w+ (?:success|failed:)/.test(line)){stack.pop();continue;}
  if(stack.at(-1)!==PUMP_PROGRAM_ID.toBase58()||!line.startsWith('Program data: '))continue;
  const b=Buffer.from(line.slice(14),'base64');if(!b.subarray(0,8).equals(disc))continue;
  const e=decoder.decodeDistributeCreatorFeesEvent(b.subarray(8));
  if(e.mint.toBase58()!==mint||!e.sharingConfig.equals(feeSharingConfigPda(new PublicKey(mint))))continue;
  if(e.quoteMint&&!e.quoteMint.equals(NATIVE_MINT)&&!e.quoteMint.equals(PublicKey.default))continue;
  if(e.shareholders.length!==1||e.shareholders[0].address.toBase58()!==treasury||e.shareholders[0].shareBps!==10000)continue;
  amount+=BigInt(e.distributed.toString());
 }
 return amount;
}
