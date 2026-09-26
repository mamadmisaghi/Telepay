import bs58 from 'bs58';
export function walletTestMessage(origin:string,address:string){return `TelePay wallet connection test\n\nOrigin: ${origin}\nWallet: ${address}\nNonce: ${crypto.randomUUID()}\nIssued: ${new Date().toISOString()}\n\nThis only tests your wallet signature. No transaction, transfer, spending approval, or Telegram verification is authorized.`;}
export async function verifyWalletSignature(address:string,message:Uint8Array,signature:Uint8Array){
 try{const key=await crypto.subtle.importKey('raw',new Uint8Array(bs58.decode(address)),{name:'Ed25519'},false,['verify']);return await crypto.subtle.verify('Ed25519',key,new Uint8Array(signature),new Uint8Array(message));}catch{return false;}
}
