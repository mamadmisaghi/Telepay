import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import bs58 from 'bs58';
import {chainService,readKey} from '../src/chain.mjs';
const config=JSON.parse(readFileSync('deploy/secrets/devnet-runtime.json','utf8'));
const sender=readKey(readFileSync('deploy/secrets/test-wallet.base58','utf8').trim()),treasury=readKey(config.DEVNET_TREASURY_KEY);
const chain=chainService({rpcUrl:'https://api.devnet.solana.com',cluster:'devnet'}),path='backend/data/devnet-funding.json';
await chain.checkNetwork();let receipt=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
if(!receipt){const tx=await chain.transfer(sender,treasury.publicKey.toBase58(),50000000n,sender);receipt={signature:bs58.encode(tx.tx.signatures[0]),wire:tx.wire,height:tx.lastValidHeight};writeFileSync(path,JSON.stringify(receipt),{mode:0o600})}
let status=await chain.status(receipt.signature,receipt.height);
if(status.state==='pending'){try{await chain.send(receipt.wire)}catch{}}
for(let i=0;i<30&&status.state==='pending';i++){await new Promise(r=>setTimeout(r,2000));status=await chain.status(receipt.signature,receipt.height)}
console.log({funding:status.state,signature:receipt.signature,treasuryBalance:await chain.connection.getBalance(treasury.publicKey,'finalized')});
if(status.state!=='confirmed')process.exitCode=1;
