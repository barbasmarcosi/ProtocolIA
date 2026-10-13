import {useState} from 'react';
import {useGetTool,useListTools} from '../../generated/orval/tools';
import {useIncreaseQuantityAndRefresh,useCreateToolAndRefresh,useRenameToolAndRefresh} from '../../api/cache';
import {ApiHttpError} from '../../api/http';
import type {ToolRequest,QuantityAdjustment,ToolNameChange} from '../../generated/orval/models';
import {getView,labelFor,listFields} from '../../protocolia-ui/bindings';
import {SchemaToolForm} from './SchemaToolForm';

function errorText(error:unknown):string{
 if(error instanceof ApiHttpError){
  if(error.status===401)return '401 · Credenciales incorrectas o sesión no autorizada.';
  if(error.status===403)return '403 · No tenés permiso para esta operación.';
  if(error.status===404)return '404 · El herramienta no existe.';
  if(error.status===409)return '409 · El recurso ya existe o la operación entra en conflicto.';
  if(error.status===400)return '400 · Los datos enviados no cumplen el contrato.';
  return String(error.status)+' · Error del servidor.';
 }
 return error instanceof Error?error.message:'Error inesperado.';
}
type Props={mode:'writer'|'reader';onLogout:()=>void};
export function ToolsScreen({mode,onLogout}:Props){
 const [limit,setLimit]=useState(5);
 const [offset,setOffset]=useState(0);
 const [code,setIsbn]=useState<string|null>(null);
 const [notice,setNotice]=useState('');
 const [mutationError,setMutationError]=useState('');
 const query=useListTools({limit,offset},{query:{retry:false}});
 const detail=useGetTool(code??'',{query:{enabled:Boolean(code),retry:false}});
 const creating=useCreateToolAndRefresh();
 const adjusting=useIncreaseQuantityAndRefresh();
 const renaming=useRenameToolAndRefresh();
 const writable=mode==='writer'; // Convenience only; backend enforces inventory.write.
 const rows=query.data?.items??[];
 const total=query.data?.total??0;
 const canNext=offset+limit<total;
 const canPrevious=offset>0;

 async function create(data:Record<string,unknown>){
  setMutationError('');
  try{
   const tool=await creating.mutateAsync({data:data as unknown as ToolRequest});
   setNotice('Herramienta creado: '+tool.code);
   setIsbn(tool.code);
   setOffset(0);
  }catch(e){setMutationError(errorText(e));throw e;}
 }
 async function requantity(data:Record<string,unknown>){
  if(!code)throw new Error('Elegí un herramienta primero.');
  setMutationError('');
  try{
   const tool=await adjusting.mutateAsync({code,data:data as unknown as QuantityAdjustment});
   setNotice('Existencias actualizadas: '+tool.quantity+' unidades');
  }catch(e){setMutationError(errorText(e));throw e;}
 }
 async function rename(data:Record<string,unknown>){
  if(!code)throw new Error('Elegí un herramienta primero.');
  setMutationError('');
  try{
   const tool=await renaming.mutateAsync({code,data:data as unknown as ToolNameChange});
   setNotice('Nombre actualizado: '+tool.name);
  }catch(e){setMutationError(errorText(e));throw e;}
 }
 return <div className="app-frame">
  <header className="site-header">
   <div><p className="eyebrow">ProtocolIA / P5</p><h1>Catálogo de herramientas</h1></div>
   <div className="session"><span>{mode==='writer'?'Vista de gestión':'Vista de lectura'}</span><button className="secondary" onClick={onLogout}>Cerrar sesión</button></div>
  </header>
  <main className="dashboard">
   <section className="panel list-panel" aria-label="Lista de herramientas">
    <div className="panel-head"><div><h2>{getView('list').name}</h2><p className="subtle">Paginación real, orden estable por código</p></div></div>
    {query.isPending&&<p role="status">Cargando herramientas…</p>}
    {query.isError&&<div className="error" role="alert">{errorText(query.error)} <button className="secondary" onClick={()=>void query.refetch()}>Reintentar</button></div>}
    {query.isSuccess&&<>{rows.length===0?<p className="empty">Todavía no hay herramientas en esta página.</p>:
     <div className="table-scroll"><table><thead><tr>{listFields.map(f=><th key={f}>{labelFor(f)}</th>)}<th>Acción</th></tr></thead>
      <tbody>{rows.map(tool=><tr key={tool.code} className={code===tool.code?'selected':''}>
       {listFields.map(f=><td key={f}>{String(tool[f])}</td>)}
       <td><button type="button" className="secondary small-button" onClick={()=>{setIsbn(tool.code);setNotice('');}}>Ver detalle</button></td>
      </tr>)}</tbody></table></div>}
     <div className="pagination">
      <label>Por página <select aria-label="Por página" value={limit} onChange={e=>{setLimit(Number(e.target.value));setOffset(0);}}>
        {[1,5,10,25,50].map(n=><option key={n} value={n}>{n}</option>)}
      </select></label>
      <span role="status">Mostrando {rows.length?offset+1:0}–{offset+rows.length} de {total}</span>
      <div><button className="secondary" disabled={!canPrevious} onClick={()=>setOffset(Math.max(0,offset-limit))}>Anterior</button>
       <button className="secondary" disabled={!canNext} onClick={()=>setOffset(offset+limit)}>Siguiente</button></div>
     </div></>}
   </section>
   <div className="sidebar">
    {writable&&<section className="panel" aria-label="Registrar herramienta">
     <SchemaToolForm role="create" pending={creating.isPending} onValid={create}/>
    </section>}
    <section className="panel" aria-label="Detalle del herramienta">
     <h2>{getView('detail').name}</h2>
     {!code&&<p className="subtle">Seleccioná un herramienta de la lista o creá uno nuevo.</p>}
     {code&&detail.isPending&&<p role="status">Cargando detalle…</p>}
     {code&&detail.isError&&<p className="error" role="alert">{errorText(detail.error)}</p>}
     {code&&detail.isSuccess&&<>
      <dl className="details">{getView('detail').fields.map(field=><div key={field}><dt>{labelFor(field)}</dt><dd>{String(detail.data[field as keyof typeof detail.data])}</dd></div>)}</dl>
      {writable&&<>
       <SchemaToolForm key={code+'quantity'} role="requantity" pending={adjusting.isPending} onValid={requantity}/>
       <SchemaToolForm key={code+'rename'} role="rename" pending={renaming.isPending} onValid={rename}/>
      </>}
     </>}
    </section>
   </div>
   {(notice||mutationError)&&<div className={mutationError?'notification error':'notification'} role={mutationError?'alert':'status'}>{mutationError||notice}</div>}
  </main>
 </div>;
}
