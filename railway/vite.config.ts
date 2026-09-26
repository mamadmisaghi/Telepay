import {defineConfig,mergeConfig} from 'vite';
import base from '../vps/vite.config';
import {fileURLToPath} from 'node:url';
export default mergeConfig(base,defineConfig({root:fileURLToPath(new URL('./',import.meta.url)),build:{outDir:fileURLToPath(new URL('../railway-dist',import.meta.url)),emptyOutDir:true}}));
