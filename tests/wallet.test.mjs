import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import bs58 from 'bs58';
import {verifyWalletSignature,walletTestMessage} from '../lib/wallet-signature.ts';
test('wallet test accepts the real signer and rejects altered messages, signatures and accounts',async()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const address=bs58.encode(publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const text=walletTestMessage('https://telepaid.example',address),message=new TextEncoder().encode(text),signature=sign(null,message,privateKey);
 assert.ok(text.includes('No transaction'));assert.ok(text.includes('https://telepaid.example'));
 assert.notEqual(walletTestMessage('https://telepaid.example',address),text);
 assert.equal(await verifyWalletSignature(address,message,signature),true);
 assert.equal(await verifyWalletSignature(address,new TextEncoder().encode(text+'!'),signature),false);
 assert.equal(await verifyWalletSignature(bs58.encode(new Uint8Array(32).fill(2)),message,signature),false);
 assert.equal(await verifyWalletSignature(address,message,new Uint8Array(64)),false);
});
