import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolsScreen } from './features/tools/ToolsScreen';
import { configureTransport, clearTransport } from './api/http';

type Session = { username: string; password: string; roleHint: 'writer' | 'reader' };
const queryClient = new QueryClient({
  defaultOptions: { queries: {retry: false, refetchOnWindowFocus: false} },
});

function BasicLogin({onLogin}:{onLogin:(session:Session)=>void}) {
  const [username,setUsername] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [checking,setChecking] = useState(false);
  const [roleHint,setRoleHint] = useState<Session['roleHint']>('writer');
  async function submit(e: React.FormEvent<HTMLFormElement>){
   e.preventDefault();setError('');setChecking(true);
   try{
    const resp=await fetch('/api/tools?limit=1&offset=0',{
      headers:{Authorization:encodeBasic(username,password),Accept:'application/json'}
    });
    if(resp.status===401||resp.status===403){setError('Credenciales incorrectas o sin permiso.');return;}
    if(!resp.ok){setError('No se pudo iniciar sesión (HTTP '+resp.status+').');return;}
    onLogin({username,password,roleHint});
   }catch{setError('No hay conexión con la API.');}
   finally{setChecking(false);}
  }
  return <main className="login-shell">
    <section className="login-panel" aria-label="Acceso al taller">
      <p className="eyebrow">ProtocolIA / Taller P5</p>
      <h1>Herramientas del taller</h1>
      <p className="subtle">Aplicación experimental sobre PostgreSQL descartable. Contraseña solamente en memoria de esta pestaña.</p>
      <form onSubmit={submit}>
        <label className="field-label">Usuario<input required value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label>
        <label className="field-label">Contraseña<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>
        <label className="field-label">Vista
          <select value={roleHint} onChange={e=>setRoleHint(e.target.value as Session['roleHint'])}>
            <option value="writer">Gestor</option><option value="reader">Lector</option>
          </select>
        </label>
        <button className="primary" type="submit" disabled={checking}>{checking?'Validando…':'Entrar al inventario'}</button>
       {error&&<p className="error" role="alert">{error}</p>}
      </form>
      <p className="subtle small">La vista elegida no otorga permisos: el backend valida cada solicitud.</p>
    </section>
  </main>;
}

function encodeBasic(user: string, password: string): string {
  const bytes=new TextEncoder().encode(user+':'+password);
  let binary=''; for(const b of bytes) binary+=String.fromCharCode(b);
  return 'Basic '+btoa(binary);
}

export default function App() {
  const [session,setSession]=useState<Session|null>(null);
  const onLogin=(s:Session)=>{
    // Data from one identity cannot remain cached for another identity.
    queryClient.clear();
    configureTransport({baseUrl: window.location.origin+'/',getHeaders:()=>({
      Authorization:encodeBasic(s.username,s.password),
    })});
    setSession(s);
  };
  const logout=()=>{queryClient.clear();clearTransport();setSession(null);};
  return <QueryClientProvider client={queryClient}>
    {session ? <ToolsScreen key={session.username+'|'+session.roleHint} mode={session.roleHint} onLogout={logout}/> : <BasicLogin onLogin={onLogin}/>}
  </QueryClientProvider>;
}
