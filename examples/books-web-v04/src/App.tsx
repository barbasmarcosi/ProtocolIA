import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BooksScreen } from './features/books/BooksScreen';
import { configureTransport, clearTransport } from './api/http';

type Session = { username: string; password: string; roleHint: 'writer' | 'reader' };
const queryClient = new QueryClient({
  defaultOptions: { queries: {retry: false, refetchOnWindowFocus: false} },
});

function BasicLogin({onLogin}:{onLogin:(session:Session)=>void}) {
  const [username,setUsername] = useState('');
  const [password,setPassword] = useState('');
  const [roleHint,setRoleHint] = useState<Session['roleHint']>('writer');
  return <main className="login-shell">
    <section className="login-panel" aria-label="Acceso al catálogo">
      <p className="eyebrow">ProtocolIA / G3 Pilot</p>
      <h1>Catálogo de libros</h1>
      <p className="subtle">Frontend derivado del contrato. Las credenciales de prueba se conservan solamente en la memoria de esta pestaña.</p>
      <form onSubmit={e=>{e.preventDefault();onLogin({username,password,roleHint});}}>
        <label className="field-label">Usuario<input required value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label>
        <label className="field-label">Contraseña<input required type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label>
        <label className="field-label">Vista
          <select value={roleHint} onChange={e=>setRoleHint(e.target.value as Session['roleHint'])}>
            <option value="writer">Gestor</option><option value="reader">Lector</option>
          </select>
        </label>
        <button className="primary" type="submit">Entrar al catálogo</button>
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
    {session ? <BooksScreen key={session.username+'|'+session.roleHint} mode={session.roleHint} onLogout={logout}/> : <BasicLogin onLogin={onLogin}/>}
  </QueryClientProvider>;
}
