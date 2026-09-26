import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({root:fileURLToPath(new URL('./',import.meta.url)),publicDir:project+'public',plugins:[react()],resolve:{alias:[{find:'@',replacement:project},{find:/^pino$/,replacement:project+'build/pino-browser.mjs'}]},optimizeDeps:{include:['pino/browser.js']},css:{postcss:project},build:{outDir:project+'vps-dist',emptyOutDir:true},server:{host:'0.0.0.0',allowedHosts:['terminal.local'],proxy:{'/api':'http://127.0.0.1:3001'}}});
