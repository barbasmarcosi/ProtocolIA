#!/usr/bin/env bash
set -euo pipefail
export PROTOCOLIA_USER=integration-only
export PROTOCOLIA_PASSWORD=integration-only-test-password-2026
export PROTOCOLIA_SCOPES=catalog.read,catalog.write
export PROTOCOLIA_VIEWER_USER=catalog-viewer
export PROTOCOLIA_VIEWER_PASSWORD=integration-viewer-password-2026
export G3_BACKEND_URL=http://127.0.0.1:10111
/opt/java/openjdk/bin/java -Dserver.port=10111 -jar /tmp/books.jar >/tmp/g3-backend.log 2>&1 &
backend_pid=$!
npm run preview -- --host 0.0.0.0 >/tmp/g3-vite.log 2>&1 &
ui_pid=$!
cleanup(){ kill "$ui_pid" "$backend_pid" 2>/dev/null || true; }
trap cleanup EXIT
ready=0
for i in $(seq 1 100); do
  if node -e "Promise.all([fetch('http://127.0.0.1:10111/health'),fetch('http://127.0.0.1:4173/')]).then(x=>process.exit(x.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"; then ready=1;break;fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then cat /tmp/g3-backend.log /tmp/g3-vite.log; exit 1;fi
# Both allowed and disallowed Host headers are tested against the same
# production-build preview used for the browser suite.
node --input-type=module <<'JS'
import http from 'node:http';
const response = (host,path='/') => new Promise((resolve,reject)=>{
  http.get({hostname:'127.0.0.1',port:4173,path,headers:{Host:host}},r=>{
    r.resume(); r.on('end',()=>resolve(r.statusCode));
  }).on('error',reject);
});
const publicHost='protocolia-g3-books-rjsf-20261012.onrender.com';
const allowed = await response(publicHost);
const proxied = await response(publicHost,'/health');
const rejected = await response('attacker.invalid');
if(allowed!==200 || proxied!==200 || rejected!==403)
  throw new Error('Host policy/proxy mismatch: '+JSON.stringify({allowed,proxied,rejected}));
console.log('G3_PUBLIC_HOST_ALLOWLIST_AND_UNKNOWN_HOST_DENIAL_PASS');
JS
if ! npm run test:browser; then cat /tmp/g3-backend.log /tmp/g3-vite.log;exit 1;fi
echo 'G3_REAL_BROWSER_E2E_PASS'
