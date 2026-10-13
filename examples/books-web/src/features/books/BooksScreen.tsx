import {useState} from 'react';
import {useGetBook,useListBooks} from '../../generated/orval/books';
import {useAdjustStockAndRefresh,useCreateBookAndRefresh,useRenameBookAndRefresh} from '../../api/cache';
import {ApiHttpError} from '../../api/http';
import type {BookRequest,StockAdjustment,TitleChange} from '../../generated/orval/models';
import {getView,labelFor,listFields} from '../../protocolia-ui/bindings';
import {SchemaBookForm} from './SchemaBookForm';

function errorText(error:unknown):string{
 if(error instanceof ApiHttpError){
  if(error.status===401)return '401 · Credenciales incorrectas o sesión no autorizada.';
  if(error.status===403)return '403 · No tenés permiso para esta operación.';
  if(error.status===404)return '404 · El libro no existe.';
  if(error.status===409)return '409 · El recurso ya existe o la operación entra en conflicto.';
  if(error.status===400)return '400 · Los datos enviados no cumplen el contrato.';
  return String(error.status)+' · Error del servidor.';
 }
 return error instanceof Error?error.message:'Error inesperado.';
}
type Props={mode:'writer'|'reader';onLogout:()=>void};
export function BooksScreen({mode,onLogout}:Props){
 const [limit,setLimit]=useState(5);
 const [offset,setOffset]=useState(0);
 const [isbn,setIsbn]=useState<string|null>(null);
 const [notice,setNotice]=useState('');
 const [mutationError,setMutationError]=useState('');
 const query=useListBooks({limit,offset},{query:{retry:false}});
 const detail=useGetBook(isbn??'',{query:{enabled:Boolean(isbn),retry:false}});
 const creating=useCreateBookAndRefresh();
 const adjusting=useAdjustStockAndRefresh();
 const renaming=useRenameBookAndRefresh();
 const writable=mode==='writer'; // Convenience only; backend enforces catalog.write.
 const rows=query.data?.items??[];
 const total=query.data?.total??0;
 const canNext=offset+limit<total;
 const canPrevious=offset>0;

 async function create(data:Record<string,unknown>){
  setMutationError('');
  try{
   const book=await creating.mutateAsync({data:data as unknown as BookRequest});
   setNotice('Libro creado: '+book.isbn);
   setIsbn(book.isbn);
   setOffset(0);
  }catch(e){setMutationError(errorText(e));throw e;}
 }
 async function restock(data:Record<string,unknown>){
  if(!isbn)throw new Error('Elegí un libro primero.');
  setMutationError('');
  try{
   const book=await adjusting.mutateAsync({isbn,data:data as unknown as StockAdjustment});
   setNotice('Stock actualizado: '+book.stock+' unidades');
  }catch(e){setMutationError(errorText(e));throw e;}
 }
 async function rename(data:Record<string,unknown>){
  if(!isbn)throw new Error('Elegí un libro primero.');
  setMutationError('');
  try{
   const book=await renaming.mutateAsync({isbn,data:data as unknown as TitleChange});
   setNotice('Título actualizado: '+book.title);
  }catch(e){setMutationError(errorText(e));throw e;}
 }
 return <div className="app-frame">
  <header className="site-header">
   <div><p className="eyebrow">ProtocolIA / G3</p><h1>Catálogo de libros</h1></div>
   <div className="session"><span>{mode==='writer'?'Vista de gestión':'Vista de lectura'}</span><button className="secondary" onClick={onLogout}>Cerrar sesión</button></div>
  </header>
  <main className="dashboard">
   <section className="panel list-panel" aria-label="Lista de libros">
    <div className="panel-head"><div><h2>{getView('list').title}</h2><p className="subtle">Paginación real, orden estable por ISBN</p></div></div>
    {query.isPending&&<p role="status">Cargando libros…</p>}
    {query.isError&&<div className="error" role="alert">{errorText(query.error)} <button className="secondary" onClick={()=>void query.refetch()}>Reintentar</button></div>}
    {query.isSuccess&&<>{rows.length===0?<p className="empty">Todavía no hay libros en esta página.</p>:
     <div className="table-scroll"><table><thead><tr>{listFields.map(f=><th key={f}>{labelFor(f)}</th>)}<th>Acción</th></tr></thead>
      <tbody>{rows.map(book=><tr key={book.isbn} className={isbn===book.isbn?'selected':''}>
       {listFields.map(f=><td key={f}>{String(book[f])}</td>)}
       <td><button type="button" className="secondary small-button" onClick={()=>{setIsbn(book.isbn);setNotice('');}}>Ver detalle</button></td>
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
    {writable&&<section className="panel" aria-label="Crear libro">
     <SchemaBookForm role="create" pending={creating.isPending} onValid={create}/>
    </section>}
    <section className="panel" aria-label="Detalle del libro">
     <h2>{getView('detail').title}</h2>
     {!isbn&&<p className="subtle">Seleccioná un libro de la lista o creá uno nuevo.</p>}
     {isbn&&detail.isPending&&<p role="status">Cargando detalle…</p>}
     {isbn&&detail.isError&&<p className="error" role="alert">{errorText(detail.error)}</p>}
     {isbn&&detail.isSuccess&&<>
      <dl className="details">{getView('detail').fields.map(field=><div key={field}><dt>{labelFor(field)}</dt><dd>{String(detail.data[field as keyof typeof detail.data])}</dd></div>)}</dl>
      {writable&&<>
       <SchemaBookForm key={isbn+'stock'} role="restock" pending={adjusting.isPending} onValid={restock}/>
       <SchemaBookForm key={isbn+'rename'} role="rename" pending={renaming.isPending} onValid={rename}/>
      </>}
     </>}
    </section>
   </div>
   {(notice||mutationError)&&<div className={mutationError?'notification error':'notification'} role={mutationError?'alert':'status'}>{mutationError||notice}</div>}
  </main>
 </div>;
}
