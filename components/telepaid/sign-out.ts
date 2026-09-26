export const walletDisconnectedKey='telepaid:wallet-disconnected';
export const telegramSessionVersionKey='telepaid:telegram-session-v2';

export function rememberVerifiedSession(){try{localStorage.setItem(telegramSessionVersionKey,'ready')}catch{}}

export async function signOutBrowser(){
 const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
 if(!response.ok)throw new Error('Could not sign out of Telegram. Please try again.');
 try{sessionStorage.removeItem('telepaid:telegram-verification')}catch{}
 rememberVerifiedSession();
 window.dispatchEvent(new Event('telepaid:logged-out'));
}
