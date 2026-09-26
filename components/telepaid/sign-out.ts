export const walletDisconnectedKey='telepaid:wallet-disconnected';

export async function signOutBrowser(){
 const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
 if(!response.ok)throw new Error('Could not sign out of Telegram. Please try again.');
 try{sessionStorage.removeItem('telepaid:telegram-verification')}catch{}
 window.dispatchEvent(new Event('telepaid:logged-out'));
}
