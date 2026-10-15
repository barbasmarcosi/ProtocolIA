import NotificationInbox from "./NotificationInbox.jsx";
import React,{useEffect,useMemo,useRef,useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";

function route(operation, code) {
  return operation.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(code));
}
const fieldWords={badge:"legajo",volunteer:"personal",period:"período",incident:"emergencias",mandatory:"asistencia",guard:"guardia",internal:"orden interno",other:"adicionales",base:"base",points:"puntos",status:"estado",number:"número",name:"nombre",code:"código",section:"sección",rank:"rango",leave:"licencia",kind:"tipo",days:"días",notes:"observaciones",evaluation:"evaluación",monthly:"mensual",created:"creado",updated:"actualizado"};
function label(field){
  if(field.label)return field.label;
  return field.name.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ")
    .split(/\s+/).map(s=>fieldWords[s.toLowerCase()]??s.toLowerCase()).join(" ")
    .replace(/^./,c=>c.toUpperCase());
}
function fieldLabel(field){
  const caption=label(field);
  return field.reference?caption.replace(/ (código|legajo|id)$/i,""):caption;
}
function visibleColumns(entity){
  // Presentation is intentionally separate from domain schema. The full record stays in Detail.
  const fields=entity.fields;
  const identity=fields.find(f=>f.name===entity.publicIdentity);
  const named=fields.find(f=>f.name==="name"&&f!==identity);
  const relations=fields.filter(f=>f.reference);
  const preferred=fields.filter(f=>f.computedSum);
  const others=fields.filter(f=>f!==identity&&f!==named&&!f.reference&&!f.computedSum&&
    (f.name==="period"||f.name==="status"||f.type==="utcDateTime"));
  const candidates=[identity,named,...relations,...others,...preferred].filter(Boolean);
  return [...new Map(candidates.map(f=>[f.name,f])).values()].slice(0,5);
}
function cellText(value){
  if(value===null||value===undefined||value==="")return "Sin dato";
  const states={draft:"Borrador",closed:"Cerrado"};
  return states[String(value)]??String(value);
}
function relationshipName(field,value,referenceOptions){
  const ref=referenceOptions[field.name]?.find(item=>String(item.key)===String(value));
  return ref?.displayName??cellText(value);
}
function displayCell(field,value,referenceOptions){
  if(!field.reference)return cellText(value);
  const name=relationshipName(field,value,referenceOptions);
  if(name===cellText(value))return name;
  return <span className="entity-reference"><span>{name}</span><span className="entity-reference-code">{value}</span></span>;
}
function isMonthField(field){
  // Presentation fallback only; a future contract-defined format overrides this heuristic.
  return field.name.toLowerCase()==="period"&&field.type==="string"&&field.minLength===7&&field.maxLength===7;
}
function validateCreate(fields,values){
  const errors={};
  for(const field of fields){
    if(field.computedSum||field.initial!==undefined)continue;
    const value=values[field.name];
    const text=String(value??"").trim();
    if(field.required&&!text){errors[field.name]="Este campo es obligatorio.";continue;}
    if(!text)continue;
    if(field.type==="int32"){
      const n=Number(text);
      if(!Number.isInteger(n)){errors[field.name]="Ingresá un número entero válido.";continue;}
      if(field.min!==undefined&&n<field.min){errors[field.name]="El mínimo permitido es "+field.min+".";continue;}
      if(field.max!==undefined&&n>field.max){errors[field.name]="El máximo permitido es "+field.max+".";continue;}
    }else if(field.type==="string"){
      if(field.minLength!==undefined&&text.length<field.minLength){
        errors[field.name]="Ingresá al menos "+field.minLength+" caracteres.";continue;
      }
      if(field.maxLength!==undefined&&text.length>field.maxLength){
        errors[field.name]="Se permiten como máximo "+field.maxLength+" caracteres.";continue;
      }
      if(isMonthField(field)&&!/^\\d{4}-(0[1-9]|1[0-2])$/.test(text)){
        errors[field.name]="Elegí un período válido (año y mes).";continue;
      }
    }
  }
  return errors;
}
function createEmpty(fields){
  return Object.fromEntries(fields.filter(f=>!f.computedSum).map(field=>[field.name,
    field.initial??(field.type==="int32"?0:"")]));
}
function normalizePayload(fields,values){
  const result={};
  for(const field of fields){
    if(field.computedSum)continue;
    const value=values[field.name];
    if(field.type==="int32"){result[field.name]=Number(value);continue;}
    if(field.type==="utcDateTime"&&!value){continue;}
    if(!field.required&&!value){continue;}
    result[field.name]=value;
  }
  return result;
}
function LoadingIndicator({message,compact=false}){
  return <span className={compact?"loading-indicator compact":"loading-indicator"} role="status" aria-live="polite">
    <span className="loading-spinner" aria-hidden="true"/>
    <span>{message}</span>
  </span>;
}
function FormField({field,value,onChange,choices,referenceState,pickerOpen=false,onPickerOpenChange,validationError}){
  const fieldId=React.useId();
  if(field.reference){
    const state=referenceState?.state??"loading";
    const blocked=state!=="ready";
    const title=fieldLabel(field);
    const targetLabel=referenceState?.resourceLabel??label({name:field.reference.target});
    return <div className="field relation-field">
      <span className="field-label" id={fieldId}>{title}{field.required?" *":""}</span>
      <Select.Root name={field.name} value={value??""} open={pickerOpen}
        onOpenChange={onPickerOpenChange} onValueChange={next=>onChange(field.name,next)}
        required={field.required} disabled={blocked}>
        <Select.Trigger data-testid={"create-"+field.name} data-selected-key={value??""}
          className="relation-trigger" aria-labelledby={fieldId} aria-busy={state==="loading"} aria-invalid={Boolean(validationError)} aria-describedby={validationError?fieldId+"-error":undefined}>
          <Select.Value placeholder={state==="loading"?"Preparando opciones…":"Seleccionar "+title.toLowerCase()}/>
          <Select.Icon className="relation-chevron" aria-hidden="true">⌄</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="relation-dropdown" position="popper" sideOffset={5} collisionPadding={12}>
            <Select.ScrollUpButton className="relation-scroll-button" aria-label="Desplazar opciones hacia arriba">⌃</Select.ScrollUpButton>
            <Select.Viewport className="relation-options">
              {(choices??[]).map(item=>
                <Select.Item className="relation-option" key={item.key} value={String(item.key)}>
                  <div className="relation-option-main">
                    <Select.ItemText>{item.displayName??String(item.key)}</Select.ItemText>
                    {item.displayName&&String(item.displayName)!==String(item.key)&&
                      <span className="relation-option-code" aria-hidden="true">{item.key}</span>}
                  </div>
                  <Select.ItemIndicator className="relation-option-check" aria-hidden="true">✓</Select.ItemIndicator>
                </Select.Item>
              )}
            </Select.Viewport>
            <Select.ScrollDownButton className="relation-scroll-button" aria-label="Desplazar opciones hacia abajo">⌄</Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {state==="loading"&&<LoadingIndicator message={"Cargando "+targetLabel.toLowerCase()+"…"} compact/>}
      {state==="empty"&&<span className="field-hint" role="status">
        Primero creá un registro de {targetLabel}.
      </span>}
      {validationError&&<span id={fieldId+"-error"} className="field-hint error" role="alert">{validationError}</span>}
      {state==="error"&&<span className="field-hint error" role="alert">
        {referenceState?.message??"No se pudieron cargar las opciones relacionadas."}
      </span>}
    </div>;
  }
  return <label className="field">
    <span>{label(field)}{field.required?" *":""}</span>
    <input data-testid={"create-"+field.name} type={field.type==="int32"?"number":isMonthField(field)?"month":"text"} required={field.required}
      aria-invalid={Boolean(validationError)} aria-describedby={validationError?fieldId+"-error":undefined}
      min={field.min??undefined} max={field.max??undefined}
      maxLength={field.maxLength??undefined}
      value={value??""} readOnly={field.initial!==undefined} onChange={event=>onChange(field.name,event.target.value)}/>
    {validationError&&<span id={fieldId+"-error"} className="field-hint error" role="alert">{validationError}</span>}
  </label>;
}
export default function App(){
  const [config,setConfig]=useState(null);
  const [resourceIndex,setResourceIndex]=useState(0);
  const [referenceOptions,setReferenceOptions]=useState({});
  const [referenceStatus,setReferenceStatus]=useState({});
  const [startupError,setStartupError]=useState("");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [auth,setAuth]=useState("");
  const [capabilities,setCapabilities]=useState([]);
  const [loginError,setLoginError]=useState("");
  const [loginBusy,setLoginBusy]=useState(false);
  const [items,setItems]=useState([]);
  const [total,setTotal]=useState(0);
  const [offset,setOffset]=useState(0);
  const [limit]=useState(25);
  const [draftFilters,setDraftFilters]=useState({});
  const [appliedFilters,setAppliedFilters]=useState({});
  const [selected,setSelected]=useState(null);
  const [detailOpen,setDetailOpen]=useState(false);
  const [creating,setCreating]=useState(false);
  const [activePicker,setActivePicker]=useState("");
  const detailOpener=useRef(null);
  const createOpener=useRef(null);
  const listHeading=useRef(null);
  const [auditItems,setAuditItems]=useState([]);
  const [auditTotal,setAuditTotal]=useState(0);
  const [auditOffset,setAuditOffset]=useState(0);
  const [auditBusy,setAuditBusy]=useState(false);
  const [auditError,setAuditError]=useState("");
  const [form,setForm]=useState({});
  const [rename,setRename]=useState("");
  const [reassigned,setReassigned]=useState("");
  const [increment,setIncrement]=useState(1);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [fieldErrors,setFieldErrors]=useState({});
  const [notice,setNotice]=useState("");
  useEffect(()=>{fetch("/protocolia-ui.json").then(async r=>{
    if(!r.ok)throw Error("Missing generated UI manifest");
    return r.json();
  }).then(c=>{setConfig(c);setForm(createEmpty(c.entity.fields));}).catch(e=>setStartupError(e.message));},[]);
  const active=config?.resources?.[resourceIndex]??config;
  const operations=useMemo(()=>active?.operations??{},[active]);
  const transitions=active?.transitions??[];
  const can=(kind)=>Boolean(operations[kind]&&capabilities.includes(operations[kind].capability));
  const searchFilters=operations.queryPage?.behavior?.filters??[];
  const tableColumns=useMemo(()=>active?.entity?visibleColumns(active.entity):[],[active?.entity]);
  const referencesReady=active?.entity?.fields.filter(f=>f.reference)
    .every(f=>referenceStatus[f.name]?.state==="ready")??true;
  function listing(){
    const kind=can("queryPage")?"queryPage":"listPage";
    const query={limit,offset};
    if(kind==="queryPage")for(const filter of searchFilters){
      const value=appliedFilters[filter.parameter];
      if(value===undefined||value==="")continue;
      query[filter.parameter]=filter.type==="utcDateTime"?new Date(value).toISOString():value;
    }
    return {kind,query};
  }

  async function request(kind,{body,code,query}={}){
    const operation=operations[kind]??transitions.find(x=>x.name===kind);
    if(!operation)throw Error("Operation is not in the contract: "+kind);
    const suffix=query?"?"+new URLSearchParams(query):"";
    const response=await fetch(route(operation,code)+suffix,{
      method:operation.method,
      headers:{"Authorization":"Basic "+auth,...(body===undefined?{}:{"Content-Type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const text=await response.text();
    let data;try{data=JSON.parse(text);}catch{data={};}
    if(!response.ok){
      const descriptions={
        400:"La operación fue rechazada. Revisá los campos marcados y sus límites.",
        401:"Sesión inválida. Volvé a iniciar sesión.",
        403:"No tenés permiso para esta operación.",
        404:"El registro ya no existe.",
        409:"Conflicto: no es posible completar la operación."
      };
      throw Error(descriptions[response.status]??"Error HTTP "+response.status+" — "+kind);
    }
    return data;
  }
  async function refresh(){
    if(!config||!auth)return;
    setLoading(true);setError("");
    try{
      const args=listing();
      const data=await request(args.kind,{query:args.query});
      if(!Array.isArray(data.items))throw Error("Invalid paginated response");
      setItems(data.items);setTotal(data.total);
    }catch(e){setError(e.message);}finally{setLoading(false);}
  }
  useEffect(()=>{
    if(!active)return;
    setForm(createEmpty(active.entity.fields));setFieldErrors({});
    setSelected(null);setDetailOpen(false);setCreating(false);setActivePicker("");setItems([]);setOffset(0);setReferenceOptions({});setReferenceStatus({});
    setAuditItems([]);setAuditTotal(0);setAuditOffset(0);setAuditError("");
    setDraftFilters({});setAppliedFilters({});
  },[active?.entity.name]);
  useEffect(()=>{if(active&&auth)refresh();},[active?.entity.name,auth,offset,JSON.stringify(appliedFilters)]);
  useEffect(()=>{
    if(!config||!active||!auth)return;
    let valid=true;
    async function loadReferences(){
      const fields=active.entity.fields.filter(f=>f.reference);
      if(!fields.length)return;
      setReferenceStatus(Object.fromEntries(fields.map(f=>[f.name,{state:"loading"}])));
      const found={},statuses={};
      for(const field of fields){
        const target=config.resources?.find(r=>r.entity.name===field.reference.target);
        if(!target||!capabilities.includes(target.operations.listPage?.capability)){
          statuses[field.name]={state:"error",resourceLabel:target?.view??field.reference.target,message:"No tenés permiso de lectura sobre "+field.reference.target+"."};
          continue;
        }
        try{
          const response=await fetch(target.operations.listPage.path+"?limit=50&offset=0",{
            headers:{Authorization:"Basic "+auth}
          });
          if(!response.ok)throw Error("No se pudo consultar "+field.reference.target+" (HTTP "+response.status+").");
          const result=await response.json();
          if(!Array.isArray(result.items)||!Number.isInteger(result.total)||
             result.total>result.items.length){
            throw Error("La selección de "+field.reference.target+
              " requiere búsqueda paginada (fuera del perfil actual).");
          }
          found[field.name]=result.items.map(item=>({
            key:item[target.entity.publicIdentity],
            displayName:item.name?String(item.name):String(item[target.entity.publicIdentity])
          }));
          statuses[field.name]={state:found[field.name].length?"ready":"empty",resourceLabel:target.view??label({name:target.entity.name})};
        }catch(e){
          statuses[field.name]={state:"error",resourceLabel:target.view??label({name:target.entity.name}),message:e.message};
        }
      }
      if(valid){setReferenceOptions(found);setReferenceStatus(statuses);}
    }
    loadReferences().catch(e=>{if(valid)setError(e.message);});
    return ()=>{valid=false;};
  },[active?.entity.name,auth,capabilities.join("|")]);
  useEffect(()=>{
    const audit=active?.operations?.auditPage;
    const code=selected?.[active?.entity?.publicIdentity];
    if(!auth||!audit||!capabilities.includes(audit.capability)||!code){
      setAuditItems([]);setAuditTotal(0);setAuditError("");return;
    }
    let valid=true;
    setAuditBusy(true);setAuditError("");
    request("auditPage",{code,query:{limit:10,offset:auditOffset}}).then(data=>{
      if(!valid)return;
      if(!Array.isArray(data.items)||!Number.isInteger(data.total))throw Error("Invalid audit response");
      setAuditItems(data.items);setAuditTotal(data.total);
    }).catch(e=>{if(valid){setAuditItems([]);setAuditError(e.message);}})
      .finally(()=>{if(valid)setAuditBusy(false);});
    return ()=>{valid=false;};
  },[auth,active?.entity.name,selected,auditOffset,capabilities.join("|")]);
  async function logIn(event){
    event.preventDefault();
    setLoginBusy(true);setLoginError("");setError("");setNotice("");
    const candidate=btoa(username+":"+password);
    try{
      const response=await fetch("/api/_protocolia/me",{headers:{Authorization:"Basic "+candidate}});
      if(!response.ok)throw Error("Authentication HTTP "+response.status);
      const session=await response.json();
      if(!Array.isArray(session.capabilities))throw Error("Invalid server capability response");
      setCapabilities(session.capabilities);
      setAuth(candidate);
      setPassword("");
    }catch{
      setAuth("");setCapabilities([]);
      setLoginError("Credenciales incorrectas o servicio no disponible");
    }finally{setLoginBusy(false);}
  }
  function logOut(){
    setAuth("");setCapabilities([]);setPassword("");setSelected(null);setDetailOpen(false);setCreating(false);setActivePicker("");setItems([]);setError("");setNotice("");setAuditItems([]);setAuditOffset(0);
  }
  async function act(kind,params){
    setError("");setNotice("");setLoading(true);
    try{
      const data=await request(kind,params);
      if(kind==="delete"||kind==="create"){setDetailOpen(false);setSelected(null);}
      else if(data?.[active.entity.publicIdentity]){
        setSelected(data);
        if(kind==="reassignReference")setReassigned(data[operations.reassignReference.behavior.field]);
      }
      const messages={create:"Registro creado correctamente.",delete:"Registro eliminado correctamente.",patchFields:"Cambios guardados correctamente.",reassignReference:"Asignación actualizada correctamente.",atomicIncrement:"Cantidad actualizada correctamente."};
      setNotice(messages[kind]??"Operación realizada correctamente.");
      const args=listing();
      const pageResult=await request(args.kind,{query:args.query});
      if(!Array.isArray(pageResult.items)||!Number.isInteger(pageResult.total))
        throw Error("Invalid paginated response");
      setItems(pageResult.items);setTotal(pageResult.total);
      return data;
    }catch(e){setError(e.message);return null;}finally{setLoading(false);}
  }
  if(startupError)return <main><h1>Error de contrato</h1><p role="alert">{startupError}</p></main>;
  if(!config)return <main className="startup-loading"><LoadingIndicator message="Preparando aplicación…"/></main>;
  return <main className="shell">
    <header><div><small>ProtocolIA · generado desde contrato</small><h1>{active.view||active.entity.name}</h1></div>
      {auth&&<button className="ghost" onClick={logOut}>Salir</button>}</header>
    {!auth?<section className="panel login"><h2>Ingresar</h2>
      {loginError&&<p className="message error" role="alert">{loginError}</p>}
      <form onSubmit={logIn}><label className="field"><span>Usuario</span><input data-testid="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required/></label>
      <label className="field"><span>Contraseña</span><input data-testid="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      <button type="submit" disabled={loginBusy}>{loginBusy?<LoadingIndicator message="Verificando… " compact/>:"Entrar"}</button></form></section>:
      <>
      {(config.resources??[]).filter(r=>r.operations.inboxPage).map(r=><NotificationInbox
        key={auth+":"+r.entity.name} operations={r.operations} auth={auth} capabilities={capabilities}/>)}
      {(config.resources?.length??0)>1&&<nav className="resource-nav" aria-label="Recursos">
        {config.resources.map((r,i)=><button key={r.entity.name}
          className={resourceIndex===i?"":"ghost"}
          aria-current={resourceIndex===i?"page":undefined}
          onClick={()=>setResourceIndex(i)}>{r.view||r.entity.name}</button>)}
      </nav>}
      {error&&!selected&&!creating&&<p className="message error" role="alert">{error}</p>}
      {notice&&!selected&&!creating&&<p className="message" role="status">{notice}</p>}
      {can("queryPage")&&<section className="panel" data-testid="query-filters">
        <h2>Buscar y filtrar</h2>
        <form onSubmit={event=>{event.preventDefault();setOffset(0);setAppliedFilters({...draftFilters});}}>
          <div className="fields">{searchFilters.map(filter=>
            <label className="field" key={filter.parameter}>
              <span>{label({name:filter.parameter})}</span>
              <input aria-label={label({name:filter.parameter})} type={filter.type==="utcDateTime"?"datetime-local":
                filter.type==="int32"?"number":"text"} value={draftFilters[filter.parameter]??""}
                onChange={event=>setDraftFilters(old=>({...old,[filter.parameter]:event.target.value}))}/>
            </label>)}
          </div>
          <div className="actions"><button type="submit">Filtrar</button>
            <button type="button" className="ghost" onClick={()=>{
              setDraftFilters({});setOffset(0);setAppliedFilters({});}}>Limpiar filtros</button>
          </div>
        </form>
      </section>}
      <section className="panel">
        <div className="heading"><h2 ref={listHeading} tabIndex={-1}>Listado <span className="muted">({total})</span></h2><div className="toolbar">
          {can("create")&&<button data-testid="open-create" onClick={event=>{createOpener.current=event.currentTarget;setForm(createEmpty(active.entity.fields));setFieldErrors({});setError("");setCreating(true);}}>Nuevo registro</button>}
          <button className="ghost" onClick={refresh}>Actualizar</button></div></div>
        {loading&&<div className="list-loading"><LoadingIndicator message="Actualizando registros…"/></div>}
        <div className="scroll data-table-scroll"><table className="data-table"><thead><tr>{tableColumns.map(f=><th key={f.name} scope="col">{fieldLabel(f)}</th>)}<th scope="col" className="table-action">Acción</th></tr></thead>
        <tbody>{items.map(item=><tr key={item[active.entity.publicIdentity]}>
          {tableColumns.map(f=><td key={f.name}>{displayCell(f,item[f.name],referenceOptions)}</td>)}
          <td className="table-action"><button className="ghost" data-testid={"open-detail-"+item[active.entity.publicIdentity]} onClick={event=>{detailOpener.current=event.currentTarget;setError("");setNotice("");setAuditOffset(0);setSelected(item);setDetailOpen(true);setRename(String(operations.patchFields?item[operations.patchFields.behavior.field]??"": ""));setReassigned(String(operations.reassignReference?item[operations.reassignReference.behavior.field]??"":""));}}>Detalle</button></td>
        </tr>)}</tbody></table></div>
        {items.length===0&&!loading&&<p>No hay registros.</p>}
        <div className="paging"><button className="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Anterior</button>
          <span>{total===0?0:offset+1}–{Math.min(offset+limit,total)} de {total}</span>
          <button className="ghost" disabled={offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Siguiente</button></div>
      </section>
      <Dialog.Root open={creating} onOpenChange={open=>{if(!loading){setCreating(open);if(!open)setActivePicker("");}}}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay"/>
          <Dialog.Content className="modal-content" aria-modal={true} aria-describedby={undefined} data-testid="create-dialog"
            onEscapeKeyDown={event=>{if(activePicker){event.preventDefault();setActivePicker("");}}}
            onCloseAutoFocus={event=>{if(createOpener.current?.isConnected){event.preventDefault();createOpener.current.focus();}}}>
            <div className="modal-header"><Dialog.Title className="modal-title">Nuevo registro</Dialog.Title>
              <Dialog.Close asChild><button type="button" className="ghost" aria-label="Cerrar creación" disabled={loading}>Cerrar</button></Dialog.Close></div>
            <div className="modal-scroll">
              {error&&<p className="message error" role="alert">{error}</p>}
        <form noValidate data-testid={"create-form-"+active.entity.name} onSubmit={async event=>{event.preventDefault();
          if(!referencesReady){setError("Esperá a que estén disponibles las opciones relacionadas.");return;}
          const errors=validateCreate(active.entity.fields,form);
          setFieldErrors(errors);
          if(Object.keys(errors).length){
            setError("Revisá los campos marcados para continuar.");
            const invalid=Object.keys(errors)[0];
            event.currentTarget.querySelector(`[data-testid="create-${invalid}"]`)?.focus();
            return;
          }
          const data=await act("create",{body:normalizePayload(active.entity.fields,form)});
          if(data){setForm(createEmpty(active.entity.fields));setFieldErrors({});setCreating(false);}
        }}><div className="fields">{active.entity.fields.filter(field=>!field.computedSum&&field.initial===undefined).map(field=><FormField key={field.name} field={field} value={form[field.name]} choices={referenceOptions[field.name]}
          referenceState={referenceStatus[field.name]} validationError={fieldErrors[field.name]}
          pickerOpen={activePicker===field.name}
          onPickerOpenChange={open=>setActivePicker(open?field.name:"")}
          onChange={(name,value)=>{setForm(prev=>({...prev,[name]:value}));setFieldErrors(prev=>{const updated={...prev};delete updated[name];return updated;});}}/>)}</div>
          <div className="modal-actions"><button type="button" className="ghost" onClick={()=>setCreating(false)} disabled={loading}>Cancelar</button>
          <button type="submit" disabled={loading||!referencesReady}>{loading?"Guardando…":"Crear"}</button></div></form>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={detailOpen} onOpenChange={open=>{if(!loading)setDetailOpen(open);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay"/>
          {selected&&<Dialog.Content data-testid="detail-dialog" aria-modal={true} className="modal-content"
            aria-describedby={undefined}
            onCloseAutoFocus={event=>{event.preventDefault();
              const origin=detailOpener.current?.isConnected?detailOpener.current:listHeading.current;
              origin?.focus();setSelected(null);
            }}>
            <div className="modal-header"><Dialog.Title className="modal-title">Detalle: {selected[active.entity.publicIdentity]}</Dialog.Title>
              <Dialog.Close asChild><button type="button" className="ghost" aria-label="Cerrar detalle" disabled={loading}>Cerrar</button></Dialog.Close></div>
            <div className="modal-scroll">
            {error&&<p className="message error" role="alert">{error}</p>}
            {notice&&<p className="message" role="status">{notice}</p>}
        <dl>{active.entity.fields.map(field=><React.Fragment key={field.name}><dt>{fieldLabel(field)}</dt><dd>{displayCell(field,selected[field.name],referenceOptions)}</dd></React.Fragment>)}</dl>
        <div className="actions">
          {can("patchFields")&&<form onSubmit={e=>{e.preventDefault();act("patchFields",{code:selected[active.entity.publicIdentity],body:{[operations.patchFields.behavior.input]:rename}});}}>
            <label className="field"><span>Modificar {operations.patchFields.behavior.field}</span><input data-testid="rename" value={rename} onChange={e=>setRename(e.target.value)}/></label>
            <button type="submit" disabled={loading}>Guardar cambios</button></form>}
          {can("reassignReference")&&<form data-testid="reassign-reference" onSubmit={e=>{
              e.preventDefault();
              const field=operations.reassignReference.behavior.field;
              act("reassignReference",{code:selected[active.entity.publicIdentity],
                body:{expected:selected[field],[field]:reassigned}});
            }}>
            <label className="field"><span>Reasignar {label({name:operations.reassignReference.behavior.field})}</span>
              <select required value={reassigned} onChange={e=>setReassigned(e.target.value)}>
                <option value="">Elegir responsable</option>
                {(referenceOptions[operations.reassignReference.behavior.field]??[]).map(item=>
                  <option key={item.key} value={item.key}>{item.displayName??item.key}</option>)}
              </select>
            </label>
            <button type="submit" disabled={loading||!referenceOptions[operations.reassignReference.behavior.field]||
              reassigned===selected[operations.reassignReference.behavior.field]}>Reasignar</button>
          </form>}
          {can("atomicIncrement")&&<form onSubmit={e=>{e.preventDefault();act("atomicIncrement",{code:selected[active.entity.publicIdentity],body:{[operations.atomicIncrement.behavior.input]:Number(increment)}});}}>
            <label className="field"><span>Incrementar {label({name:operations.atomicIncrement.behavior.field})}</span><input data-testid="increment" type="number" min={1} value={increment} onChange={e=>setIncrement(e.target.value)}/></label>
            <button type="submit" disabled={loading}>Incrementar</button></form>}
          {transitions.filter(op=>capabilities.includes(op.capability) &&
            selected[op.behavior.field]===op.behavior.from).map(op=>
            <button type="button" className="ghost" key={op.name} data-testid={"transition-"+op.name}
              disabled={loading} onClick={()=>act(op.name,{code:selected[active.entity.publicIdentity]})}>
              {label({name:op.name})}: {op.behavior.to}
            </button>)}
        </div>
        {can("auditPage")&&<section className="audit-history" data-testid="audit-history">
          <div className="heading"><h3>Historial de cambios <span className="muted">({auditTotal})</span></h3></div>
          {auditBusy&&<div className="list-loading"><LoadingIndicator message="Cargando historial…"/></div>}
          {auditError&&<p role="alert" className="message error">{auditError}</p>}
          {!auditBusy&&!auditError&&<div className="scroll"><table aria-label="Historial de cambios">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Operación</th><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
            <tbody>{auditItems.map(entry=><tr key={entry.id}>
              <td>{entry.occurredAt}</td><td>{entry.actor}</td><td>{entry.operationName}</td>
              <td>{entry.fieldName}</td><td>{entry.beforeValue??"—"}</td><td>{entry.afterValue??"—"}</td>
            </tr>)}</tbody>
          </table></div>}
          {!auditBusy&&!auditError&&auditTotal===0&&<p>No hay cambios registrados.</p>}
          <div className="paging">
            <button className="ghost" data-testid="audit-prev" disabled={auditBusy||auditOffset===0}
              onClick={()=>setAuditOffset(Math.max(0,auditOffset-10))}>Anterior</button>
            <span>{auditTotal===0?0:auditOffset+1}–{Math.min(auditOffset+10,auditTotal)} de {auditTotal}</span>
            <button className="ghost" data-testid="audit-next" disabled={auditBusy||auditOffset+10>=auditTotal}
              onClick={()=>setAuditOffset(auditOffset+10)}>Siguiente</button>
          </div>
        </section>}
        {can("delete")&&<button className="ghost" disabled={loading} onClick={()=>{
          if(!window.confirm("¿Eliminar "+selected[active.entity.publicIdentity]+"?"))return;
          act("delete",{code:selected[active.entity.publicIdentity]});
        }}>Eliminar</button>}
            </div>
          </Dialog.Content>}
        </Dialog.Portal>
      </Dialog.Root>
      </>
    }
  </main>;
}
