import React from 'react';
import {createRoot} from 'react-dom/client';
import {LiveApp} from '../components/telepaid/live-app';
import '../app/globals.css';
import {WalletProvider} from '../components/telepaid/wallet-context';
// A VPS build always renders live data or an explicit service error, never demo balances.
createRoot(document.getElementById('root')!).render(<React.StrictMode><WalletProvider><LiveApp/></WalletProvider></React.StrictMode>);
