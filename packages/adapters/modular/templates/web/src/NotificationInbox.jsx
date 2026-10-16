import React,{useEffect,useState} from 'react';

export default function NotificationInbox({operations,auth,capabilities}){
 const [open,setOpen]=useState(false),[offset,setOffset]=useState(0),[reload,setReload]=useState(0);
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const page=operations.inboxPage,ack=operations.ackNotification,limit=10;
 const canRead=page&&capabilities.includes(page.capability);
 const canAck=ack&&capabilities.includes(ack.capability);
 async function request(operation,url,signal){
  const response=await fetch(url,{method:operation.method,headers:{Authorization:auth},signal});
  if(!response.ok)throw Error(response.status===403?'No tenés una identidad destinataria habilitada o el permiso necesario.':
   response.status===404?'La notificación no está disponible.':response.status===401?'Volvé a iniciar sesión.':'No se pudo completar la operación.');
  return response.json();
 }
 useEffect(()=>{
  if(!open||!canRead)return;
  const controller=new AbortController();
  setBusy(true);setError('');setData(null);
  request(page,page.path+'?'+new URLSearchParams({limit,offset}),controller.signal)
   .then(value=>{if(!controller.signal.aborted)setData(value);})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return ()=>controller.abort();
 },[open,offset,reload,auth,page?.path,canRead]);
 if(!canRead)return null;
 async function recognize(id){
  setBusy(true);setError('');
  try{
   await request(ack,ack.path.replace('{notificationId}',encodeURIComponent(id)));
   setReload(n=>n+1);
  }catch(e){setError(e.message);setBusy(false);}
 }
 return <section className="panel notification-inbox" data-testid="notification-inbox">
  <div className="heading"><h2>Notificaciones</h2>
   <button className="ghost" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Ocultar bandeja':'Abrir bandeja'}</button></div>
  {open&&<>
   <p className="muted">Avisos dirigidos a tu usuario.</p>
   {error&&<p role="alert" className="message error">{error}</p>}
   {busy&&<p role="status">Cargando notificaciones…</p>}
   {data&&<>
    <div className="notification-cards">{data.items.map(item=><article key={item.id} data-testid="notification-card" className="notification-card">
     <div className="heading"><strong>{item.entityName}: {item.resourceId}</strong><span>{item.readAt?'Leída':'No leída'}</span></div>
     <dl><dt>Destinatario</dt><dd>{item.recipientKey}</dd>
      <dt>Fecha del evento</dt><dd><time dateTime={item.eventAt}>{new Date(item.eventAt).toLocaleString()}</time></dd>
      <dt>Disponible desde</dt><dd><time dateTime={item.notifiedAt}>{new Date(item.notifiedAt).toLocaleString()}</time></dd></dl>
     {canAck&&!item.readAt&&<button disabled={busy} onClick={()=>recognize(item.id)}>Marcar como leída</button>}
    </article>)}</div>
    {!data.items.length&&<p>No hay notificaciones en esta página.</p>}
    <div className="paging"><button disabled={busy||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-limit))}>Anteriores</button>
     <span>{data.total===0?0:Math.min(offset+1,data.total)}–{Math.min(offset+limit,data.total)} de {data.total}</span>
     <button disabled={busy||offset+limit>=data.total} onClick={()=>setOffset(n=>n+limit)}>Siguientes</button></div>
   </>}
   <button className="ghost" disabled={busy} onClick={()=>setReload(n=>n+1)}>Actualizar bandeja</button>
  </>}
 </section>;
}
