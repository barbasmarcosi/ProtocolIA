import React,{useEffect,useRef,useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";

function itemOf(row,target){
  const key=String(row[target.entity.publicIdentity]);
  return {key,displayName:String(row.name??key)};
}
async function read(url,auth,signal){
  const response=await fetch(url,{headers:{Authorization:"Basic "+auth},signal});
  if(!response.ok){
    const error=new Error(({401:"Sesión inválida.",403:"No tenés permiso de consulta.",
      404:"Registro inexistente."})[response.status]??"Error HTTP "+response.status);
    error.status=response.status;throw error;
  }
  return response.json();
}
/** Always pages at the server: text search exists only for contract-approved filters. */
export default function PagedReferencePicker({field,value,onChange,onResolve,choices=[],target,auth,
  pickerOpen,onPickerOpenChange,validationError,title,labelId,descriptionIds}){
  const filters=target.operations.queryPage?.behavior?.filters??[];
  const nameFilter=filters.find(f=>f.operator==="contains"&&!f.via&&f.field==="name");
  const idFilter=filters.find(f=>f.operator==="contains"&&!f.via&&f.field===target.entity.publicIdentity);
  const [mode,setMode]=useState(nameFilter?"name":"identity");
  const [term,setTerm]=useState("");
  const [offset,setOffset]=useState(0);
  const [result,setResult]=useState({items:[],total:0});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [caption,setCaption]=useState("");
  const searchInput=useRef(null);
  const limit=25;

  useEffect(()=>{
    if(!value){setCaption("");return;}
    const cached=choices.find(x=>String(x.key)===String(value));
    if(cached){setCaption(cached.displayName??String(value));return;}
    const op=target.operations.get;
    if(!op){setCaption(String(value));return;}
    const cancel=new AbortController();
    read(op.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(value)),
      auth,cancel.signal).then(row=>{
        if(cancel.signal.aborted)return;
        const option=itemOf(row,target);
        setCaption(option.displayName);
        onResolve?.(field.name,option);
      }).catch(()=>{if(!cancel.signal.aborted)setCaption(String(value));});
    return ()=>cancel.abort();
  },[value,auth,target.entity.name]);

  useEffect(()=>{
    if(!pickerOpen)return;
    const cancel=new AbortController();
    const timer=setTimeout(async()=>{
      setBusy(true);setError("");
      try{
        const text=term.trim(),filter=mode==="name"?nameFilter:idFilter;
        let data;
        if(text&&mode==="identity"&&!filter){
          const op=target.operations.get;
          if(!op)throw Error("El contrato no permite esta consulta.");
          try{
            const row=await read(op.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(text)),
              auth,cancel.signal);
            data={items:[row],total:1};
          }catch(e){if(e.status===404)data={items:[],total:0};else throw e;}
        }else{
          const op=text&&filter?target.operations.queryPage:target.operations.listPage;
          if(!op)throw Error("El contrato no permite listar esta relación.");
          const query={limit,offset};
          if(text&&filter)query[filter.parameter]=text;
          data=await read(op.path+"?"+new URLSearchParams(query),auth,cancel.signal);
        }
        if(cancel.signal.aborted)return;
        if(!Array.isArray(data.items)||!Number.isInteger(data.total)||data.total<0)
          throw Error("El servidor devolvió una página inválida.");
        setResult({items:data.items.map(row=>itemOf(row,target)),total:data.total});
      }catch(e){
        if(!cancel.signal.aborted){setResult({items:[],total:0});setError(e.message);}
      }finally{if(!cancel.signal.aborted)setBusy(false);}
    },term.trim()?280:0);
    return ()=>{clearTimeout(timer);cancel.abort();};
  },[pickerOpen,term,mode,offset,auth,target.entity.name]);

  function choose(option){
    onChange(field.name,option.key);
    onResolve?.(field.name,option);
    setCaption(option.displayName);
    onPickerOpenChange(false);
  }
  const exact=Boolean(term.trim()&&mode==="identity"&&!idFilter);
  return <Dialog.Root open={pickerOpen} onOpenChange={open=>{
    if(open){setTerm("");setOffset(0);setMode(nameFilter?"name":"identity");}
    onPickerOpenChange(open);
  }}>
    <Dialog.Trigger asChild><button type="button"
      data-testid={"create-"+field.name} data-selected-key={value??""}
      className="relation-trigger relation-search-trigger"
      aria-labelledby={labelId} aria-describedby={descriptionIds}
      aria-invalid={Boolean(validationError)}>
      <span className={value?"relation-trigger-value":"relation-trigger-placeholder"}>
        {value?(caption||choices.find(x=>String(x.key)===String(value))?.displayName||String(value)):
          "Seleccionar "+title.toLowerCase()}
      </span><span className="relation-chevron" aria-hidden="true">⌄</span>
    </button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="relation-search-overlay"/>
      <Dialog.Content className="relation-search-dialog" aria-describedby={undefined}
        onOpenAutoFocus={event=>{event.preventDefault();searchInput.current?.focus();}}>
        <div className="relation-search-heading">
          <div><Dialog.Title className="relation-search-title">Elegir {title.toLowerCase()}</Dialog.Title>
            <p className="field-hint">Seleccioná un registro. Todas las páginas provienen del servidor.</p></div>
          <Dialog.Close asChild><button className="ghost icon-button" type="button" aria-label="Cerrar selector">×</button></Dialog.Close>
        </div>
        <div className="relation-search-controls">
          <label className="field"><span>Buscar por</span>
            <select aria-label="Campo de búsqueda" value={mode} onChange={e=>{
              setMode(e.target.value);setTerm("");setOffset(0);
            }}>
              {nameFilter&&<option value="name">Nombre</option>}
              <option value="identity">{target.entity.fields.find(f=>f.name===target.entity.publicIdentity)?.uiLabel??"Identificador"}</option>
            </select></label>
          <label className="field relation-search-input"><span>{exact?"Identificador exacto":"Buscar registros"}</span>
            <input ref={searchInput} type="search" value={term} maxLength={120}
              placeholder={mode==="name"?"Escribí un nombre…":"Escribí un identificador…"}
              onChange={e=>{setTerm(e.target.value);setOffset(0);}}
              aria-label={"Buscar "+title.toLowerCase()}/></label>
        </div>
        {!nameFilter&&<p className="field-hint">Para buscar por nombre, el contrato debe autorizar un filtro de texto.</p>}
        <div className="relation-search-body" aria-busy={busy}>
          {busy&&<span className="relation-search-progress" role="status">Buscando registros…</span>}
          {error&&<div className="relation-search-message error" role="alert">{error}
            <button type="button" className="ghost" onClick={()=>{setTerm("");setOffset(0);}}>Volver al listado</button>
          </div>}
          {!error&&!busy&&!result.items.length&&<p className="relation-search-message" role="status">
            {term.trim()?"No hay coincidencias. Probá otro término.":"Todavía no hay registros disponibles."}
          </p>}
          {!error&&<div className="relation-search-results" role="listbox"
            aria-label={"Opciones de "+title.toLowerCase()} onKeyDown={e=>{
              if(!["ArrowDown","ArrowUp","Home","End"].includes(e.key))return;
              const buttons=[...e.currentTarget.querySelectorAll('[role="option"]')];
              if(!buttons.length)return;
              const at=buttons.indexOf(document.activeElement);
              const next=e.key==="Home"?0:e.key==="End"?buttons.length-1:
                e.key==="ArrowDown"?Math.min(at+1,buttons.length-1):Math.max(at-1,0);
              buttons[next]?.focus();e.preventDefault();
            }}>
            {result.items.map(option=><button type="button" role="option" key={option.key}
              aria-selected={String(value)===option.key} className="relation-search-option"
              onClick={()=>choose(option)}>
              <span>{option.displayName}</span>
              {option.key!==option.displayName&&<span className="relation-option-code">{option.key}</span>}
              {String(value)===option.key&&<span aria-hidden="true">✓</span>}
            </button>)}
          </div>}
        </div>
        {!exact&&<div className="relation-search-pagination">
          <button type="button" className="ghost" disabled={busy||offset===0}
            onClick={()=>setOffset(v=>Math.max(0,v-limit))}>Anterior</button>
          <span role="status">{result.total?offset+1:0}–{Math.min(offset+limit,result.total)} de {result.total}</span>
          <button type="button" className="ghost" disabled={busy||offset+limit>=result.total}
            onClick={()=>setOffset(v=>v+limit)}>Siguiente</button>
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
