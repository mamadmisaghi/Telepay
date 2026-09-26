import React from 'react';
import {createRoot} from 'react-dom/client';
import Page from '../app/page';
import '../app/globals.css';
// Reuse the approved interface, including mock data and sidebar interactions.
createRoot(document.getElementById('root')!).render(<React.StrictMode><Page/></React.StrictMode>);
