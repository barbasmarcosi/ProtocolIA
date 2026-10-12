import {spawn} from 'node:child_process';
const backendPort=10111;
const publicPort=Number(process.env.PORT||10000);
if(!Number.isSafeInteger(publicPort)||publicPort<=0||publicPort>65535)throw new Error('Invalid PORT');
const backend=spawn('/opt/java/openjdk/bin/java',['-Dserver.port='+backendPort,'-jar','/app/backend.jar'],{stdio:'inherit'});
const frontend=spawn(process.execPath,['./node_modules/vite/bin/vite.js','preview','--host','0.0.0.0','--port',String(publicPort)],{
 stdio:'inherit',env:{...process.env,G3_BACKEND_URL:'http://127.0.0.1:'+backendPort},
});
let stopped=false;
const stop=(source,code)=>{
 if(stopped)return;
 stopped=true;
 backend.kill('SIGTERM');
 frontend.kill('SIGTERM');
 console.error(source+' exited; stopping composed G3 demo');
 process.exitCode=code??1;
};
backend.on('exit',code=>stop('Backend',code));
frontend.on('exit',code=>stop('Frontend',code));
process.on('SIGTERM',()=>stop('Termination',0));
process.on('SIGINT',()=>stop('Interrupt',0));
