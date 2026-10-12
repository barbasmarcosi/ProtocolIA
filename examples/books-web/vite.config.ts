import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const backend=process.env.G3_BACKEND_URL||'http://127.0.0.1:10111';
export default defineConfig({
 plugins:[react()],
 server:{host:'0.0.0.0',port:4173,strictPort:true,proxy:{'/api':{target:backend,changeOrigin:true},'/health':{target:backend,changeOrigin:true}}},
 preview:{host:'0.0.0.0',port:4173,strictPort:true,proxy:{'/api':{target:backend,changeOrigin:true},'/health':{target:backend,changeOrigin:true}}}
});
