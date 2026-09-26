import bs58 from 'bs58';
import {PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,PUMP_EVENT_AUTHORITY_PDA,PUMP_AMM_EVENT_AUTHORITY_PDA} from '@pump-fun/pump-sdk';
const eventTag=Buffer.from('e445a52e51cb9a1d','hex');
// Anchor stores event CPIs in transaction metadata even when runtime logs truncate.
export function completeEventLogs(tx){
 const logs=tx?.meta?.logMessages||[],extra=[],seen=new Map();
 for(const line of logs)if(line.startsWith('Program data: ')){const data=line.slice(14);seen.set(data,(seen.get(data)||0)+1);}
 if(!tx?.transaction?.message?.getAccountKeys)return logs;
 const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
 for(const group of tx.meta.innerInstructions||[])for(const ix of group.instructions){
  const program=keys.get(ix.programIdIndex),authority=program?.equals(PUMP_PROGRAM_ID)?PUMP_EVENT_AUTHORITY_PDA:program?.equals(PUMP_AMM_PROGRAM_ID)?PUMP_AMM_EVENT_AUTHORITY_PDA:null;
  if(!authority||!keys.get(ix.accounts?.[0])?.equals(authority)||!ix.data)continue;
  const bytes=Buffer.from(bs58.decode(ix.data));if(!bytes.subarray(0,8).equals(eventTag))continue;
  const data=bytes.subarray(8).toString('base64'),count=seen.get(data)||0;
  if(count){seen.set(data,count-1);continue;}
  extra.push(`Program ${program} invoke [1]`,`Program data: ${data}`,`Program ${program} success`);
 }
 return [...logs,...extra];
}
