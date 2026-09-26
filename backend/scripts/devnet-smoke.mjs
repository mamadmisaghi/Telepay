// Explicitly Devnet-only. Uses an ignored local test credential, never a production key.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chainService,readKey,signedMatches} from '../src/chain.mjs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {randomUUID} from 'node:crypto';

const chain=chainService({rpcUrl:'https://api.devnet.solana.com',cluster:'devnet'});
const wallet=readKey((await readFile(new URL('../../deploy/secrets/test-wallet.base58',import.meta.url),'utf8')).trim());
await chain.checkNetwork();
const address=wallet.publicKey.toBase58();
const message=new TextEncoder().encode(`TelePaid Devnet test only | ${randomUUID()}`);
const signature=nacl.sign.detached(message,wallet.secretKey);
if(!nacl.sign.detached.verify(message,signature,wallet.publicKey.toBytes()))throw new Error('Message signature invalid');
const balance=await chain.connection.getBalance(wallet.publicKey,'finalized');
console.log(JSON.stringify({network:'devnet',address,balanceLamports:balance,messageSignatureVerified:true}));
if(!process.argv.includes('--send'))process.exit(0);

const directory=new URL('../data/',import.meta.url),receiptFile=new URL('devnet-smoke.json',directory);
await mkdir(directory,{recursive:true,mode:0o700});
let receipt;
try{receipt=JSON.parse(await readFile(receiptFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(receipt&&(receipt.network!=='devnet'||receipt.address!==address))throw new Error('Receipt belongs to another test; refusing to send');
if(!receipt){
 if(balance<100000)throw new Error('Insufficient Devnet SOL for a test');
 // One lamport to the same wallet: only the network fee changes its balance.
 const prepared=await chain.transfer(wallet,address,1n,wallet);
 signedMatches(prepared.wire,prepared.message,address);
 const simulated=await chain.connection.simulateTransaction(prepared.tx,{sigVerify:true,commitment:'confirmed'});
 if(simulated.value.err)throw new Error(`Simulation failed: ${JSON.stringify(simulated.value.err)}`);
 const fee=(await chain.connection.getFeeForMessage(prepared.tx.message,'confirmed')).value;
 if(fee===null||fee>10000)throw new Error('Unexpected test transaction fee');
 receipt={network:'devnet',address,signature:bs58.encode(prepared.tx.signatures[0]),wire:prepared.wire,lastValidHeight:prepared.lastValidHeight,balanceBefore:balance,expectedFeeLamports:fee,status:'prepared',createdAt:new Date().toISOString()};
 await writeFile(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600});
}
let status=await chain.status(receipt.signature,receipt.lastValidHeight);
if(status.state==='pending'){
 try{await chain.send(receipt.wire);}catch{console.log('Send response uncertain; checking the persisted signature.');}
}
for(let attempt=0;attempt<30&&status.state==='pending';attempt++){
 await new Promise(resolve=>setTimeout(resolve,2000));
 status=await chain.status(receipt.signature,receipt.lastValidHeight);
}
receipt.status=status.state;
if(status.state==='confirmed'){
 const delta=await chain.receivedBy(receipt.signature,address);
 if(delta.lamports!==-BigInt(receipt.expectedFeeLamports))throw new Error('Unexpected finalized wallet balance delta');
 receipt.finalizedSlot=delta.slot;receipt.walletDeltaLamports=delta.lamports.toString();
}
await writeFile(receiptFile,JSON.stringify(receipt,null,2),{mode:0o600});
const {wire,...publicReceipt}=receipt;
console.log(JSON.stringify(publicReceipt,null,2));
if(status.state!=='confirmed')process.exitCode=1;
