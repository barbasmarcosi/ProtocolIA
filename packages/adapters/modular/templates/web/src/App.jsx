import React,{useEffect,useMemo,useState} from "react";

function route(operation, code) {
  return operation.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(code));
}
function label(field){return field.name.replace(/([a-z])([A-Z])/g,"$1 $2");}
function createEmpty(fields){
  return Object.fromEntries(fields.map(field=>[field.name,
    field.initial??(field.type==="int32"?0:"")]));
}
function normalizePayload(fields,values){
  const result={};
  for(const field of fields){
    const value=values[field.name];
    if(field.type==="int32"){result[field.name]=Number(value);continue;}
    if(field.type==="utcDateTime"&&!value){continue;}
    if(!field.required&&!value){continue;}
    result[field.name]=value;
  }
  return result;
}
function FormField({field,value,onChange,choices}){
  if(field.reference)return <label className="field">
    <span>{label(field)} — {field.reference.target}{field.required?" *":""}</span>
    <select required={field.required} value={value??""}
      onChange={event=>onChange(field.name,event.target.value)}>
      <option value="">Seleccionar {field.reference.target}</option>
      {(choices??[]).map(item=><option key={item.key} value={item.key}>{item.label}</option>)}
    </select>
  </label>;
  return <label className="field">
    <span>{label(field)}{field.required?" *":""}</span>
    <input type={field.type==="int32"?"number":"text"} required={field.required}
      min={field.min??undefined} max={field.max??undefined}
      maxLength={field.maxLength??undefined}
      value={value??""} readOnly={field.initial!==undefined} onChange={event=>onChange(field.name,event.target.value)}/>
  </label>;
}
export default function App(){
  const [config,setConfig]=useState(null);
  const [resourceIndex,setResourceIndex]=useState(0);
  const [referenceOptions,setReferenceOptions]=useState({});
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
        400:"Revisá los datos ingresados.",
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
    setForm(createEmpty(active.entity.fields));
    setSelected(null);setItems([]);setOffset(0);setReferenceOptions({});
    setAuditItems([]);setAuditTotal(0);setAuditOffset(0);setAuditError("");
    setDraftFilters({});setAppliedFilters({});
  },[active?.entity.name]);
  useEffect(()=>{if(active&&auth)refresh();},[active?.entity.name,auth,offset,JSON.stringify(appliedFilters)]);
  useEffect(()=>{
    if(!config||!active||!auth)return;
    let valid=true;
    async function loadReferences(){
      const found={};
      for(const field of active.entity.fields.filter(f=>f.reference)){
        const target=config.resources?.find(r=>r.entity.name===field.reference.target);
        if(!target||!capabilities.includes(target.operations.listPage?.capability)){
          setError("No tenés permiso de lectura sobre "+field.reference.target);
          continue;
        }
        const response=await fetch(target.operations.listPage.path+"?limit=50&offset=0",{
          headers:{Authorization:"Basic "+auth}
        });
        if(!response.ok){setError("No se pudo consultar "+field.reference.target);continue;}
        const result=await response.json();
        if(!Array.isArray(result.items)||result.total>result.items.length){
          setError("La selección de "+field.reference.target+" requiere búsqueda paginada (fuera del perfil actual)");
          continue;
        }
        found[field.name]=result.items.map(item=>({
          key:item[target.entity.publicIdentity],
          label:String(item[target.entity.publicIdentity])+
            (item.name?" — "+item.name:"")
        }));
      }
      if(valid)setReferenceOptions(found);
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
    setAuth("");setCapabilities([]);setPassword("");setSelected(null);setItems([]);setError("");setNotice("");setAuditItems([]);setAuditOffset(0);
  }
  async function act(kind,params){
    setError("");setNotice("");setLoading(true);
    try{
      const data=await request(kind,params);
      if(kind==="delete")setSelected(null);
      else if(data?.[active.entity.publicIdentity]){
        setSelected(data);
        if(kind==="reassignReference")setReassigned(data[operations.reassignReference.behavior.field]);
      }
      setNotice("Operación confirmada: "+kind);
      const args=listing();
      const pageResult=await request(args.kind,{query:args.query});
      if(!Array.isArray(pageResult.items)||!Number.isInteger(pageResult.total))
        throw Error("Invalid paginated response");
      setItems(pageResult.items);setTotal(pageResult.total);
      return data;
    }catch(e){setError(e.message);return null;}finally{setLoading(false);}
  }
  if(startupError)return <main><h1>Error de contrato</h1><p role="alert">{startupError}</p></main>;
  if(!config)return <main><p>Cargando contrato…</p></main>;
  return <main className="shell">
    <header><div><small>ProtocolIA · generado desde contrato</small><h1>{active.view||active.entity.name}</h1></div>
      {auth&&<button className="ghost" onClick={logOut}>Salir</button>}</header>
    {!auth?<section className="panel login"><h2>Ingresar</h2>
      {loginError&&<p className="message error" role="alert">{loginError}</p>}
      <form onSubmit={logIn}><label className="field"><span>Usuario</span><input data-testid="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required/></label>
      <label className="field"><span>Contraseña</span><input data-testid="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      <button type="submit" disabled={loginBusy}>{loginBusy?"Verificando…":"Entrar"}</button></form></section>:
      <>
      {(config.resources?.length??0)>1&&<nav className="resource-nav" aria-label="Recursos">
        {config.resources.map((r,i)=><button key={r.entity.name}
          className={resourceIndex===i?"":"ghost"}
          aria-current={resourceIndex===i?"page":undefined}
          onClick={()=>setResourceIndex(i)}>{r.view||r.entity.name}</button>)}
      </nav>}
      {error&&<p className="message error" role="alert">{error}</p>}
      {notice&&<p className="message" role="status">{notice}</p>}
      {can("queryPage")&&<section className="panel" data-testid="query-filters">
        <h2>Buscar y filtrar</h2>
        <form onSubmit={event=>{event.preventDefault();setOffset(0);setAppliedFilters({...draftFilters});}}>
          <div className="fields">{searchFilters.map(filter=>
            <label className="field" key={filter.parameter}>
              <span>{label({name:filter.parameter})}</span>
              <input aria-label={filter.parameter} type={filter.type==="utcDateTime"?"datetime-local":
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
        <div className="heading"><h2>Listado <span className="muted">({total})</span></h2><button className="ghost" onClick={refresh}>Actualizar</button></div>
        {loading&&<p aria-live="polite">Cargando…</p>}
        <div className="scroll"><table><thead><tr>{active.entity.fields.map(f=><th key={f.name}>{label(f)}</th>)}<th>Acción</th></tr></thead>
        <tbody>{items.map(item=><tr key={item[active.entity.publicIdentity]}>
          {active.entity.fields.map(f=><td key={f.name}>{item[f.name]??"—"}</td>)}
          <td><button className="ghost" onClick={()=>{setAuditOffset(0);setSelected(item);setRename(String(operations.patchFields?item[operations.patchFields.behavior.field]??"": ""));setReassigned(String(operations.reassignReference?item[operations.reassignReference.behavior.field]??"":""));}}>Detalle</button></td>
        </tr>)}</tbody></table></div>
        {items.length===0&&!loading&&<p>No hay registros.</p>}
        <div className="paging"><button className="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Anterior</button>
          <span>{total===0?0:offset+1}–{Math.min(offset+limit,total)} de {total}</span>
          <button className="ghost" disabled={offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Siguiente</button></div>
      </section>
      {can("create")&&<section className="panel"><h2>Crear {active.entity.name}</h2>
        <form onSubmit={async event=>{event.preventDefault();
          const data=await act("create",{body:normalizePayload(active.entity.fields,form)});
          if(data)setForm(createEmpty(active.entity.fields));
        }}><div className="fields">{active.entity.fields.map(field=><FormField key={field.name} field={field} value={form[field.name]} choices={referenceOptions[field.name]}
          onChange={(name,value)=>setForm(prev=>({...prev,[name]:value}))}/>)}</div>
          <button type="submit" disabled={loading}>Crear</button></form>
      </section>}
      {selected&&<section className="panel"><h2>Detalle: {selected[active.entity.publicIdentity]}</h2>
        <dl>{active.entity.fields.map(field=><React.Fragment key={field.name}><dt>{label(field)}</dt><dd>{selected[field.name]??"—"}</dd></React.Fragment>)}</dl>
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
                  <option key={item.key} value={item.key}>{item.label}</option>)}
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
          {auditBusy&&<p aria-live="polite">Cargando historial…</p>}
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
      </section>}
      </>
    }
  </main>;
}
