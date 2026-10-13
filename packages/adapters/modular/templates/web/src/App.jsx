import React,{useEffect,useMemo,useState} from "react";

function route(operation, code) {
  return operation.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(code));
}
function label(field){return field.name.replace(/([a-z])([A-Z])/g,"$1 $2");}
function createEmpty(fields){
  return Object.fromEntries(fields.map(field=>[field.name,
    field.type==="int32"?0:""]));
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
function FormField({field,value,onChange}){
  return <label className="field">
    <span>{label(field)}{field.required?" *":""}</span>
    <input type={field.type==="int32"?"number":"text"} required={field.required}
      min={field.min??undefined} max={field.max??undefined}
      maxLength={field.maxLength??undefined}
      value={value??""} onChange={event=>onChange(field.name,event.target.value)}/>
  </label>;
}
export default function App(){
  const [config,setConfig]=useState(null);
  const [startupError,setStartupError]=useState("");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [auth,setAuth]=useState("");
  const [items,setItems]=useState([]);
  const [total,setTotal]=useState(0);
  const [offset,setOffset]=useState(0);
  const [limit]=useState(25);
  const [selected,setSelected]=useState(null);
  const [form,setForm]=useState({});
  const [rename,setRename]=useState("");
  const [increment,setIncrement]=useState(1);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  useEffect(()=>{fetch("/protocolia-ui.json").then(async r=>{
    if(!r.ok)throw Error("Missing generated UI manifest");
    return r.json();
  }).then(c=>{setConfig(c);setForm(createEmpty(c.entity.fields));}).catch(e=>setStartupError(e.message));},[]);
  const operations=useMemo(()=>config?.operations??{},[config]);

  async function request(kind,{body,code,query}={}){
    const operation=operations[kind];
    if(!operation)throw Error("Operation is not in the contract: "+kind);
    const suffix=query?"?"+new URLSearchParams(query):"";
    const response=await fetch(route(operation,code)+suffix,{
      method:operation.method,
      headers:{"Authorization":"Basic "+auth,...(body===undefined?{}:{"Content-Type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const text=await response.text();
    let data;try{data=JSON.parse(text);}catch{data={};}
    if(!response.ok)throw Error("HTTP "+response.status+" — "+kind);
    return data;
  }
  async function refresh(){
    if(!config||!auth)return;
    setLoading(true);setError("");
    try{
      const data=await request("listPage",{query:{limit,offset}});
      if(!Array.isArray(data.items))throw Error("Invalid paginated response");
      setItems(data.items);setTotal(data.total);
    }catch(e){setError(e.message);}finally{setLoading(false);}
  }
  useEffect(()=>{if(config&&auth)refresh();},[config,auth,offset]);
  function logIn(event){
    event.preventDefault();setError("");setNotice("");
    setAuth(btoa(username+":"+password));
  }
  async function act(kind,params){
    setError("");setNotice("");setLoading(true);
    try{
      const data=await request(kind,params);
      if(data?.[config.entity.publicIdentity])setSelected(data);
      setNotice("Operación confirmada: "+kind);
      const listing=await request("listPage",{query:{limit,offset}});
      setItems(listing.items);setTotal(listing.total);
      return data;
    }catch(e){setError(e.message);return null;}finally{setLoading(false);}
  }
  if(startupError)return <main><h1>Error de contrato</h1><p role="alert">{startupError}</p></main>;
  if(!config)return <main><p>Cargando contrato…</p></main>;
  return <main className="shell">
    <header><div><small>ProtocolIA · generado desde contrato</small><h1>{config.view||config.entity.name}</h1></div>
      {auth&&<button className="ghost" onClick={()=>{setAuth("");setPassword("");setSelected(null);setItems([]);}}>Salir</button>}</header>
    {!auth?<section className="panel login"><h2>Ingresar</h2>
      <form onSubmit={logIn}><label className="field"><span>Usuario</span><input data-testid="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required/></label>
      <label className="field"><span>Contraseña</span><input data-testid="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      <button type="submit">Entrar</button></form></section>:
      <>
      {error&&<p className="message error" role="alert">{error}</p>}
      {notice&&<p className="message" role="status">{notice}</p>}
      <section className="panel">
        <div className="heading"><h2>Listado <span className="muted">({total})</span></h2><button className="ghost" onClick={refresh}>Actualizar</button></div>
        {loading&&<p aria-live="polite">Cargando…</p>}
        <div className="scroll"><table><thead><tr>{config.entity.fields.map(f=><th key={f.name}>{label(f)}</th>)}<th>Acción</th></tr></thead>
        <tbody>{items.map(item=><tr key={item[config.entity.publicIdentity]}>
          {config.entity.fields.map(f=><td key={f.name}>{item[f.name]??"—"}</td>)}
          <td><button className="ghost" onClick={()=>{setSelected(item);setRename(String(item[operations.patchFields.behavior.field]??""));}}>Detalle</button></td>
        </tr>)}</tbody></table></div>
        {items.length===0&&!loading&&<p>No hay registros.</p>}
        <div className="paging"><button className="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Anterior</button>
          <span>{total===0?0:offset+1}–{Math.min(offset+limit,total)} de {total}</span>
          <button className="ghost" disabled={offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Siguiente</button></div>
      </section>
      <section className="panel"><h2>Crear {config.entity.name}</h2>
        <form onSubmit={async event=>{event.preventDefault();
          const data=await act("create",{body:normalizePayload(config.entity.fields,form)});
          if(data)setForm(createEmpty(config.entity.fields));
        }}><div className="fields">{config.entity.fields.map(field=><FormField key={field.name} field={field} value={form[field.name]}
          onChange={(name,value)=>setForm(prev=>({...prev,[name]:value}))}/>)}</div>
          <button type="submit" disabled={loading}>Crear</button></form>
      </section>
      {selected&&<section className="panel"><h2>Detalle: {selected[config.entity.publicIdentity]}</h2>
        <dl>{config.entity.fields.map(field=><React.Fragment key={field.name}><dt>{label(field)}</dt><dd>{selected[field.name]??"—"}</dd></React.Fragment>)}</dl>
        <div className="actions">
          <form onSubmit={e=>{e.preventDefault();act("patchFields",{code:selected[config.entity.publicIdentity],body:{[operations.patchFields.behavior.input]:rename}});}}>
            <label className="field"><span>Modificar {operations.patchFields.behavior.field}</span><input data-testid="rename" value={rename} onChange={e=>setRename(e.target.value)}/></label>
            <button type="submit" disabled={loading}>Guardar cambios</button></form>
          <form onSubmit={e=>{e.preventDefault();act("atomicIncrement",{code:selected[config.entity.publicIdentity],body:{[operations.atomicIncrement.behavior.input]:Number(increment)}});}}>
            <label className="field"><span>Incrementar {label({name:operations.atomicIncrement.behavior.field})}</span><input data-testid="increment" type="number" min={1} value={increment} onChange={e=>setIncrement(e.target.value)}/></label>
            <button type="submit" disabled={loading}>Incrementar</button></form>
        </div>
      </section>}
      </>
    }
  </main>;
}
