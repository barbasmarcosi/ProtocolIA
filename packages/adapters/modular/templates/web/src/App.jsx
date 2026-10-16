import NotificationInbox from "./NotificationInbox.jsx";
import React,{useEffect,useMemo,useRef,useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import PagedReferencePicker from "./PagedReferencePicker.jsx";
import {beginPkce,finishPkce,hasPkceResponse} from "./OAuthPkce.js";
import {authenticatedFetch,AUTH_REJECTED_EVENT,jwtExpiresAt} from "./AuthSession.js";

function route(operation, code) {
  return operation.path.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g,encodeURIComponent(code));
}
const fieldWords={badge:"legajo",volunteer:"personal",period:"período",incident:"emergencias",mandatory:"asistencia",guard:"guardia",internal:"orden interno",other:"adicionales",base:"base",points:"puntos",status:"estado",number:"número",name:"nombre",code:"código",section:"sección",rank:"rango",leave:"licencia",kind:"tipo",days:"días",units:"unidades",available:"disponible",sku:"SKU",notes:"observaciones",evaluation:"evaluación",monthly:"mensual",created:"creado",updated:"actualizado"};
function label(field){
  if(field.uiLabel)return field.uiLabel;
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
  const preferred=fields.filter(f=>f.computedSum||f.computedProduct||f.computedRoundedProduct||f.computedDiscountedTotal);
  const others=fields.filter(f=>f!==identity&&f!==named&&!f.reference&&!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal&&
    (f.name==="period"||f.name==="status"||f.type==="utcDateTime"));
  const candidates=[identity,named,...relations,...others,...preferred].filter(Boolean);
  return [...new Map(candidates.map(f=>[f.name,f])).values()].slice(0,5);
}
function cellText(value){
  if(value===null||value===undefined||value==="")return "Sin dato";
  const states={draft:"Borrador",closed:"Cerrado",active:"Activo",cancelled:"Cancelado"};
  return states[String(value)]??String(value);
}
function relationshipName(field,value,referenceOptions){
  const ref=referenceOptions[field.name]?.find(item=>String(item.key)===String(value));
  return ref?.displayName??cellText(value);
}
function displayCell(field,value,referenceOptions){
  if(!field.reference){
    const choice=field.choices?.find(option=>option.value===value);
    return choice?choice.label:cellText(value);
  }
  const name=relationshipName(field,value,referenceOptions);
  if(name===cellText(value))return name;
  return <span className="entity-reference"><span>{name}</span><span className="entity-reference-code">{value}</span></span>;
}
function transitionLabel(op){
  const verb=String(op.name??"").split(/(?=[A-Z])/)[0].toLowerCase();
  const verbs={close:"Cerrar",reopen:"Reabrir",approve:"Aprobar",reject:"Rechazar",
    publish:"Publicar",archive:"Archivar",cancel:"Cancelar",submit:"Enviar",
    activate:"Activar",deactivate:"Desactivar",complete:"Completar"};
  return (verbs[verb]??"Cambiar estado")+" registro";
}
function isMonthField(field){
  // Prefer authoritative format; legacy month hints remain a presentation fallback.
  if(field.pattern==="^[0-9]{4}-(0[1-9]|1[0-2])$")return true;
  if(field.uiControl!==undefined)return field.uiControl==="month";
  return field.name.toLowerCase()==="period"&&field.type==="string"&&field.minLength===7&&field.maxLength===7;
}
function groupCreateFields(fields){
  const visible=fields.filter(field=>!field.ownerManaged&&!field.computedSum&&!field.computedProduct&&!field.computedRoundedProduct&&!field.computedDiscountedTotal&&field.initial===undefined);
  if(!visible.some(field=>field.uiSection))return [{title:null,fields:visible}];
  const grouped=new Map();
  for(const field of visible){
    const title=field.uiSection??"Datos generales";
    if(!grouped.has(title))grouped.set(title,[]);
    grouped.get(title).push(field);
  }
  return [...grouped].map(([title,fields])=>({title,fields}));
}
function isRequiredInForm(field,values){
  return field.required||Boolean(field.requiredWhen&&
    values[field.requiredWhen.field]===field.requiredWhen.equals);
}
function decimalIssue(value,field){
  const d=field.decimal,raw=String(value??"");
  if(!d||raw.length>d.precision+d.scale+4||
     !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw))
    return "Ingresá un decimal válido usando punto, sin exponentes.";
  const neg=raw.startsWith("-");
  const [whole,fraction=""]=(neg?raw.slice(1):raw).split(".");
  if(whole.replace(/^0+/,"").length>d.precision-d.scale)
    return "El valor excede la precisión permitida.";
  if(fraction.length>d.scale)
    return "Se permiten como máximo "+d.scale+" decimales.";
  const units=s=>{
    const sign=s.startsWith("-"),[left,right=""]=(sign?s.slice(1):s).split(".");
    return BigInt((sign?"-":"")+left+right.padEnd(d.scale,"0"));
  };
  const actual=units(raw);
  if(d.min!==undefined&&actual<units(d.min))return "El mínimo permitido es "+d.min+".";
  if(d.max!==undefined&&actual>units(d.max))return "El máximo permitido es "+d.max+".";
  return null;
}
function validateCreate(fields,values,reconciliation){
  const errors={};
  for(const field of fields){
    if(field.ownerManaged||field.computedSum||field.computedProduct||field.computedRoundedProduct||field.computedDiscountedTotal||field.initial!==undefined)continue;
    const value=values[field.name];
    const text=String(value??"").trim();
    if(isRequiredInForm(field,values)&&!text){errors[field.name]="Este campo es obligatorio.";continue;}
    if(!text)continue;
    if(field.choices?.length&&!field.choices.some(choice=>choice.value===text)){
      errors[field.name]="Elegí una opción válida.";continue;
    }
    if(field.type==="utcDateTime"&&
       (field.afterField||fields.some(other=>other.afterField===field.name))){
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)||
         !Number.isFinite(Date.parse(text))){
        errors[field.name]="Ingresá una fecha y hora ISO válida.";continue;
      }
      if(field.afterField&&values[field.afterField]){
        const previous=Date.parse(String(values[field.afterField]));
        if(Number.isFinite(previous)&&Date.parse(text)<=previous){
          errors[field.name]="La fecha debe ser posterior a "+fieldLabel(fields.find(f=>f.name===field.afterField))+".";
          continue;
        }
      }
    }else if(field.type==="decimal"){
      const problem=decimalIssue(value,field);if(problem){errors[field.name]=problem;continue;}
    }else if(field.type==="int32"){
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
      if(field.pattern!==undefined&&!new RegExp(field.pattern).test(text)){
        errors[field.name]="El formato ingresado no es válido.";continue;
      }
      if(isMonthField(field)&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)){
        errors[field.name]="Elegí un período válido (año y mes).";continue;
      }
    }
  }
  for(const field of fields.filter(f=>f.forbidWhen&&!errors[f.name])){
    if(values[field.forbidWhen.field]===field.forbidWhen.equals&&
       String(values[field.name]??"").trim())
      errors[field.name]="Este campo no se admite con el estado seleccionado.";
  }
  for(const field of fields.filter(f=>f.greaterThanField!==undefined&&!errors[f.name])){
    const input=String(values[field.name]??"").trim();
    const source=fields.find(f=>f.name===field.greaterThanField);
    if(!input||!source||errors[source.name])continue;
    const sourceRaw=String(values[source.name]??"").trim();
    let invalidComparison=false;
    if(field.type==="decimal"&&source.type==="decimal"){
      if(!decimalIssue(input,field)&&!decimalIssue(sourceRaw,source)){
        const units=(value,precision)=>{
          const negative=value.startsWith("-"),[whole,part=""]=(negative?value.slice(1):value).split(".");
          return BigInt((negative?"-":"")+whole+part.padEnd(precision,"0"));
        };
        const scale=Math.max(field.decimal.scale,source.decimal.scale);
        invalidComparison=units(input,field.decimal.scale)*10n**BigInt(scale-field.decimal.scale)<=
          units(sourceRaw,source.decimal.scale)*10n**BigInt(scale-source.decimal.scale);
      }
    }else if(field.type==="int32"&&source.type==="int32"&&
      /^[-+]?\d+$/.test(input)&&/^[-+]?\d+$/.test(sourceRaw)){
      invalidComparison=Number(input)<=Number(sourceRaw);
    }
    if(invalidComparison)errors[field.name]="El valor debe ser mayor que "+fieldLabel(source)+".";
  }
  if(reconciliation){
    const opening=fields.find(f=>f.name===reconciliation.openingField);
    const available=fields.find(f=>f.name===reconciliation.availableField);
    if(opening&&available&&!errors[opening.name]&&!errors[available.name]){
      const scaled=(raw,scale)=>{
        const negative=raw.startsWith("-"),[whole,fraction=""]=(negative?raw.slice(1):raw).split(".");
        return BigInt((negative?"-":"")+whole+fraction.padEnd(scale,"0"));
      };
      if(scaled(String(values[opening.name]),opening.decimal.scale)!==
         scaled(String(values[available.name]),available.decimal.scale))
        errors[available.name]="El saldo disponible debe coincidir con el saldo inicial al crear la cuenta.";
    }
  }
  return errors;
}
function createEmpty(fields){
  return Object.fromEntries(fields.filter(f=>!f.ownerManaged&&!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal).map(field=>[field.name,
    field.initial??(field.type==="int32"&&field.required?0:"")]));
}
function normalizePayload(fields,values){
  const result={};
  for(const field of fields){
    if(field.computedSum||field.computedProduct||field.computedRoundedProduct||field.computedDiscountedTotal)continue;
    const value=values[field.name];
    if(field.type==="int32"){
      if(!field.required&&(value===undefined||value===null||String(value).trim()===""))continue;
      result[field.name]=Number(value);continue;
    }
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
// One contract-generated read-only metric, not a hand-authored page or client-side sum.
function RelatedSumPanel({operation,identity,auth,child,revision=0}){
  const [revisionLocal,setRevisionLocal]=useState(0);
  const [state,setState]=useState({loading:true,value:null,error:""});
  const childName=child.view||label({name:child.entity.name});
  const quantity=child.entity.fields.find(f=>f.name===operation.behavior.relatedSum.quantityField);
  const title="Total activo · "+childName;
  useEffect(()=>{
    const controller=new AbortController();
    setState({loading:true,value:null,error:""});
    authenticatedFetch(route(operation,identity),{
      headers:{Authorization:auth},signal:controller.signal
    }).then(async res=>{
      if(!res.ok)throw Error(res.status===403?"Sin permiso para consultar el resumen.":
        res.status===404?"El registro ya no existe.":"No se pudo cargar el resumen.");
      const payload=await res.json();
      if(!payload||typeof payload.totalUnits!=="string"||
        !/^\d{1,19}$/.test(payload.totalUnits))
        throw Error("El servicio devolvió un total inválido.");
      return BigInt(payload.totalUnits).toLocaleString("es-AR");
    }).then(value=>{if(!controller.signal.aborted)setState({loading:false,value,error:""});})
      .catch(error=>{
        if(!controller.signal.aborted)setState({loading:false,value:null,error:error.message});
      });
    return ()=>controller.abort();
  },[operation,identity,auth,revision,revisionLocal]);
  return <section className="related-summary" data-testid="related-sum-panel"
    aria-label={title}>
    <div className="related-summary-head">
      <div><h3>{title}</h3>
        <p className="related-summary-hint">Suma de {quantity?fieldLabel(quantity).toLowerCase():"cantidades"} con estado {cellText(operation.behavior.relatedSum.activeState).toLowerCase()}.</p>
      </div>
      <button type="button" className="ghost" data-testid="related-sum-refresh"
        disabled={state.loading} onClick={()=>setRevisionLocal(x=>x+1)}>Actualizar total</button>
    </div>
    {state.loading?<div className="related-summary-loading"><LoadingIndicator compact message="Calculando total…"/></div>:
      state.error?<p role="alert" className="message error" data-testid="related-sum-error">{state.error}</p>:
      <div className="related-summary-value" role="status" aria-live="polite"
        data-testid="related-sum-value">{state.value}</div>}
  </section>;
}
function LedgerReconciliationPanel({operation,identity,auth,child,revision=0}){
  const [local,setLocal]=useState(0);
  const [state,setState]=useState({loading:true,data:null,error:""});
  useEffect(()=>{
    const controller=new AbortController();
    setState({loading:true,data:null,error:""});
    authenticatedFetch(route(operation,identity),{headers:{Authorization:auth},signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw Error(response.status===403?"Sin permisos para conciliar.":
          response.status===404?"El registro ya no existe.":"No se pudo conciliar el saldo.");
        const data=await response.json();
        if(!data||typeof data.balanced!=="boolean"||
          !["openingBalance","available","postedTotal","reversedTotal","expectedAvailable","difference","postingCount"].every(key=>
            typeof data[key]==="string"&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(data[key])))
          throw Error("El servidor devolvió una conciliación inválida.");
        return data;
      }).then(data=>{if(!controller.signal.aborted)setState({loading:false,data,error:""});})
        .catch(error=>{if(!controller.signal.aborted)setState({loading:false,data:null,error:error.message});});
    return ()=>controller.abort();
  },[operation,identity,auth,revision,local]);
  const report=state.data;
  return <section className="related-summary" data-testid="ledger-reconciliation" aria-label="Conciliación de saldo">
    <div className="related-summary-head"><div><h3>Conciliación del saldo</h3>
      <p className="related-summary-hint">Comparación exacta con los movimientos de {child.view||child.entity.name}.</p>
    </div><button type="button" className="ghost" data-testid="ledger-reconciliation-refresh"
      disabled={state.loading} onClick={()=>setLocal(x=>x+1)}>Actualizar</button></div>
    {state.loading?<LoadingIndicator compact message="Conciliando saldo…"/>:
      state.error?<p role="alert" className="message error" data-testid="ledger-reconciliation-error">{state.error}</p>:
      <div><p role={report.balanced?"status":"alert"} data-testid="ledger-reconciliation-status"
        className={report.balanced?"message":"message error"}>
        {report.balanced?"Saldo conciliado.":"Desvío detectado. Revisá los movimientos y el saldo."}</p>
        <dl className="ledger-values">{[
          ["Saldo inicial",report.openingBalance],["Saldo registrado",report.available],
          ["Cargos vigentes",report.postedTotal],["Cargos revertidos",report.reversedTotal],
          ["Saldo esperado",report.expectedAvailable],["Diferencia",report.difference],
          ["Movimientos",report.postingCount]
        ].map(([name,value])=><React.Fragment key={name}><dt>{name}</dt><dd>{value}</dd></React.Fragment>)}</dl>
      </div>}
  </section>;
}
function FormField({field,value,onChange,choices,referenceState,pickerOpen=false,onPickerOpenChange,validationError,auth,onReferenceResolve,required=field.required,conditionallyRequired=false}){
  const fieldId=React.useId();
  const descriptionIds=[field.uiHelp?fieldId+"-hint":null,validationError?fieldId+"-error":null].filter(Boolean).join(" ")||undefined;
  if(field.reference){
    const state=referenceState?.state??"loading";
    const blocked=state!=="ready"&&state!=="paged";
    const title=fieldLabel(field);
    const targetLabel=referenceState?.resourceLabel??label({name:field.reference.target});
    if(state==="paged")return <div className="field relation-field">
      <span className="field-label" id={fieldId}>{title}{required?" *":""}</span>
      <PagedReferencePicker field={field} value={value} onChange={onChange} onResolve={onReferenceResolve}
        target={referenceState.target} auth={auth} choices={choices??[]}
        pickerOpen={pickerOpen} onPickerOpenChange={onPickerOpenChange}
        validationError={validationError} title={title} labelId={fieldId} descriptionIds={descriptionIds}/>
      {field.uiHelp&&<span id={fieldId+"-hint"} className="field-hint field-help-copy">{field.uiHelp}</span>}
      {validationError&&<span id={fieldId+"-error"} className="field-hint error" role="alert">{validationError}</span>}
    </div>;
    return <div className="field relation-field">
      <span className="field-label" id={fieldId}>{title}{required?" *":""}</span>
      <Select.Root name={field.name} value={value??""} open={pickerOpen}
        onOpenChange={onPickerOpenChange} onValueChange={next=>onChange(field.name,next)}
        required={required} disabled={blocked}>
        <Select.Trigger data-testid={"create-"+field.name} data-selected-key={value??""}
          className="relation-trigger" aria-labelledby={fieldId} aria-busy={state==="loading"} aria-invalid={Boolean(validationError)} aria-describedby={descriptionIds}>
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
      {field.uiHelp&&<span id={fieldId+"-hint"} className="field-hint field-help-copy">{field.uiHelp}</span>}
      {validationError&&<span id={fieldId+"-error"} className="field-hint error" role="alert">{validationError}</span>}
      {state==="error"&&<span className="field-hint error" role="alert">
        {referenceState?.message??"No se pudieron cargar las opciones relacionadas."}
      </span>}
    </div>;
  }
  if(field.choices?.length)return <div className="field relation-field">
    <span className="field-label" id={fieldId}>{fieldLabel(field)}{required?" *":""}</span>
    <Select.Root value={value??""} onValueChange={next=>onChange(field.name,next)}
      open={pickerOpen} onOpenChange={onPickerOpenChange} required={required}>
      <Select.Trigger className="relation-trigger" data-testid={"create-"+field.name}
        aria-labelledby={fieldId} aria-describedby={descriptionIds} aria-invalid={Boolean(validationError)}>
        <Select.Value placeholder={"Seleccionar "+fieldLabel(field).toLowerCase()}/>
        <Select.Icon className="relation-chevron" aria-hidden="true">⌄</Select.Icon>
      </Select.Trigger>
      <Select.Portal><Select.Content className="relation-dropdown" position="popper" sideOffset={5}
        collisionPadding={12}><Select.Viewport className="relation-options">
        {field.choices.map(choice=><Select.Item className="relation-option"
          key={choice.value} value={choice.value}>
          <Select.ItemText>{choice.label}</Select.ItemText>
          <Select.ItemIndicator className="relation-option-check" aria-hidden="true">✓</Select.ItemIndicator>
        </Select.Item>)}
      </Select.Viewport></Select.Content></Select.Portal>
    </Select.Root>
    {field.uiHelp&&<span id={fieldId+"-hint"} className="field-hint field-help-copy">{field.uiHelp}</span>}
    {validationError&&<span id={fieldId+"-error"} className="field-hint error" role="alert">{validationError}</span>}
  </div>;
  return <label className={"field"+(field.uiControl==="textarea"?" field-multiline":"")}>
    <span>{label(field)}{required?" *":""}</span>
    {field.uiControl==="textarea"?
      <textarea data-testid={"create-"+field.name} rows={3} required={required}
        placeholder={field.uiPlaceholder??undefined} maxLength={field.maxLength??undefined}
        aria-invalid={Boolean(validationError)} aria-describedby={descriptionIds}
        value={value??""} onChange={event=>onChange(field.name,event.target.value)}/>:
      <input data-testid={"create-"+field.name} type={field.type==="int32"?"number":isMonthField(field)?"month":"text"}
        inputMode={field.type==="decimal"?"decimal":undefined} autoComplete={field.type==="decimal"?"off":undefined} required={required}
        aria-invalid={Boolean(validationError)} aria-describedby={descriptionIds}
        placeholder={field.uiPlaceholder??undefined}
        min={field.min??undefined} max={field.max??undefined}
        maxLength={field.maxLength??undefined}
        value={value??""} readOnly={field.initial!==undefined} onChange={event=>onChange(field.name,event.target.value)}/>}
    {field.uiHelp&&<span id={fieldId+"-hint"} className="field-hint field-help-copy">{field.uiHelp}</span>}
    {conditionallyRequired&&<span className="field-hint" role="note">Este campo es obligatorio por el estado seleccionado.</span>}
    {validationError&&<span id={fieldId+"-error"} className="field-hint error" role="alert">{validationError}</span>}
  </label>;
}
// Route state is bound to the generated manifest, never arbitrary URL paths.
function readWorkspaceRoute(config){
  const resources=config.resources?.length?config.resources:[config],p=new URLSearchParams(window.location.search);
  const matched=resources.findIndex(r=>r.entity.name===p.get("resource"));
  const resourceIndex=matched<0?0:matched,raw=p.get("offset");
  const offset=raw&&/^\d+$/.test(raw)&&Number(raw)<=250000&&Number(raw)%25===0?Number(raw):0;
  const appliedFilters={};
  for(const f of resources[resourceIndex].operations?.queryPage?.behavior?.filters??[]){
    const value=p.get("filter."+f.parameter);
    if(value!==null&&value.length<=200)appliedFilters[f.parameter]=value;
  }
  return {resourceIndex,offset,appliedFilters,draftFilters:{...appliedFilters}};
}
function workspaceUrl(resource,view){
  const url=new URL(window.location.href);
  url.searchParams.set("resource",resource.entity.name);url.searchParams.delete("offset");
  if(view.offset>0)url.searchParams.set("offset",String(view.offset));
  for(const key of [...url.searchParams.keys()])if(key.startsWith("filter."))url.searchParams.delete(key);
  for(const f of resource.operations?.queryPage?.behavior?.filters??[]){
    const value=view.appliedFilters?.[f.parameter];
    if(value!==undefined&&value!==""&&String(value).length<=200)
      url.searchParams.set("filter."+f.parameter,String(value));
  }
  return url.pathname+url.search+url.hash;
}
const workspaceHref=()=>window.location.pathname+window.location.search+window.location.hash;
export default function App(){
  const [config,setConfig]=useState(null);
  const [resourceIndex,setResourceIndex]=useState(0);
  const [referenceOptions,setReferenceOptions]=useState({});
  const [referenceStatus,setReferenceStatus]=useState({});
  const [startupError,setStartupError]=useState("");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [auth,setAuth]=useState("");
  const [authConfig,setAuthConfig]=useState(null);
  const callbackOnce=useRef(false);
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
  const [confirmDiscard,setConfirmDiscard]=useState(false);
  const [pendingNavigation,setPendingNavigation]=useState(null);
  const navSession=useRef(null),navPosition=useRef(0),navHref=useRef(null),navRestoring=useRef(false);
  const resourceViews=useRef({}),navigationSnapshot=useRef(null),listRequestEpoch=useRef(0);
  const [activePicker,setActivePicker]=useState("");
  const detailOpener=useRef(null);
  const createOpener=useRef(null);
  const discardReturnFocus=useRef(null);
  const continueDraftButton=useRef(null);
  const listHeading=useRef(null);
  const [summaryRevision,setSummaryRevision]=useState(0);
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
  // Generated session boundary: reject only the credential whose request failed.
  // Expiration decoded from JWT is an early UX hint, never proof of identity.
  useEffect(()=>{
    if(!auth)return;
    let disposed=false,timer;
    function endSession(){
      if(disposed)return;
      logOut();
      setLoginError("Tu sesión expiró o ya no es válida. Iniciá sesión nuevamente.");
    }
    function onRejected(event){
      if(event.detail?.authorization===auth)endSession();
    }
    window.addEventListener(AUTH_REJECTED_EVENT,onRejected);
    const expiration=jwtExpiresAt(auth);
    if(expiration!==null){
      const checkExpiration=()=>{
        if(disposed)return;
        const remaining=expiration-Date.now();
        if(remaining<=0)endSession();
        else timer=setTimeout(checkExpiration,Math.min(remaining,2147483647));
      };
      checkExpiration();
    }
    return ()=>{
      disposed=true;
      window.removeEventListener(AUTH_REJECTED_EVENT,onRejected);
      clearTimeout(timer);
    };
  },[auth]);
  useEffect(()=>{
    fetch("/api/_protocolia/auth/config",{cache:"no-store"}).then(async response=>{
      if(!response.ok)throw Error("No se pudo consultar la configuración de autenticación.");
      const value=await response.json();
      if(!["demo","jwt"].includes(value.mode)||typeof value.enabled!=="boolean")
        throw Error("Configuración de autenticación inválida.");
      setAuthConfig(value);
    }).catch(error=>setStartupError(error.message));
  },[]);
  useEffect(()=>{
    if(!authConfig?.enabled||!hasPkceResponse()||callbackOnce.current)return;
    callbackOnce.current=true;
    setLoginBusy(true);setLoginError("");
    finishPkce(authConfig).then(async authorization=>{
      if(!authorization)throw Error("No se recibió una autorización.");
      const response=await fetch("/api/_protocolia/me",{
        headers:{Authorization:authorization},cache:"no-store"});
      if(!response.ok)throw Error("El servidor no aceptó la identidad del proveedor.");
      const session=await response.json();
      if(!Array.isArray(session.capabilities))throw Error("Permisos de sesión inválidos.");
      setCapabilities(session.capabilities);setAuth(authorization);
    }).catch(error=>{
      setAuth("");setCapabilities([]);setLoginError(error.message);
    }).finally(()=>setLoginBusy(false));
  },[authConfig]);
  useEffect(()=>{fetch("/protocolia-ui.json").then(async r=>{
    if(!r.ok)throw Error("Missing generated UI manifest");
    return r.json();
  }).then(c=>{
    const view=readWorkspaceRoute(c),resource=(c.resources?.length?c.resources:[c])[view.resourceIndex];
    navSession.current=Math.random().toString(36).slice(2)+Date.now().toString(36);
    navPosition.current=0;
    const url=workspaceUrl(resource,view);
    if(!hasPkceResponse())window.history.replaceState({...window.history.state,
      __protocoliaNavigation:{session:navSession.current,position:0}},"",url);
    navHref.current=url;resourceViews.current[resource.entity.name]=view;
    setResourceIndex(view.resourceIndex);setOffset(view.offset);
    setAppliedFilters(view.appliedFilters);setDraftFilters(view.draftFilters);
    setConfig(c);setForm(createEmpty(c.entity.fields));
  }).catch(e=>setStartupError(e.message));},[]);
  const active=config?.resources?.[resourceIndex]??config;
  const operations=useMemo(()=>active?.operations??{},[active]);
  const transitions=active?.transitions??[];
  const can=(kind)=>Boolean(operations[kind]&&capabilities.includes(operations[kind].capability));
  const searchFilters=operations.queryPage?.behavior?.filters??[];
  const tableColumns=useMemo(()=>active?.entity?visibleColumns({...active.entity,
    fields:active.entity.fields.filter(f=>!f.readCapability||capabilities.includes(f.readCapability))}):[],
    [active?.entity,capabilities]);
  const ledgerReconciliation=operations.reconcileExact;
  const ledgerChild=ledgerReconciliation?.behavior?.reconcileExact?
    config?.resources?.find(r=>r.entity.name===ledgerReconciliation.behavior.reconcileExact.childEntity):null;
  const canReconcile=Boolean(ledgerReconciliation&&ledgerChild&&
    capabilities.includes(ledgerReconciliation.capability)&&
    capabilities.includes(ledgerChild.operations?.get?.capability));
  const relatedSum=operations.sumRelated;
  const relatedSumChild=relatedSum?.behavior?.relatedSum?
    config?.resources?.find(r=>r.entity.name===relatedSum.behavior.relatedSum.childEntity):null;
  const canReadRelatedSum=Boolean(relatedSum&&relatedSumChild&&
    capabilities.includes(relatedSum.capability)&&
    capabilities.includes(relatedSumChild.operations?.get?.capability));
  // Generic draft baseline is built from the formal field manifest.
  const createDirty=Boolean(creating&&active?.entity?.fields.some(field=>{
    if(field.ownerManaged||field.computedSum||field.computedProduct||field.computedRoundedProduct||field.computedDiscountedTotal||field.initial!==undefined)return false;
    const initial=field.type==="int32"&&field.required?0:"";
    return String(form[field.name]??"")!==String(initial);
  }));
  navigationSnapshot.current={resourceIndex,createDirty,saving:creating&&loading};
  function applyWorkspaceRoute(view){
    setResourceIndex(view.resourceIndex);setOffset(view.offset);
    setAppliedFilters(view.appliedFilters);setDraftFilters(view.draftFilters??view.appliedFilters);
    if(view.resourceIndex!==navigationSnapshot.current.resourceIndex){
      setCreating(false);setConfirmDiscard(false);setActivePicker("");
    }
  }
  function pushWorkspaceRoute(view){
    const target=(config.resources?.length?config.resources:[config])[view.resourceIndex];
    const url=workspaceUrl(target,view);
    if(url!==navHref.current){
      const position=navPosition.current+1;
      window.history.pushState({...window.history.state,
        __protocoliaNavigation:{session:navSession.current,position}},"",url);
      navPosition.current=position;navHref.current=url;
    }
    applyWorkspaceRoute(view);
  }
  function selectResource(index){
    if(index===resourceIndex||creating&&loading)return;
    const saved=resourceViews.current[config.resources[index].entity.name];
    const view={resourceIndex:index,offset:saved?.offset??0,
      appliedFilters:{...(saved?.appliedFilters??{})},
      draftFilters:{...(saved?.draftFilters??saved?.appliedFilters??{})}};
    if(createDirty){setPendingNavigation({kind:"push",view});setConfirmDiscard(true);return;}
    pushWorkspaceRoute(view);
  }
  useEffect(()=>{
    if(!config)return;
    const onPopState=()=>{
      if(navRestoring.current){
        navRestoring.current=false;
        const marker=window.history.state?.__protocoliaNavigation;
        if(marker?.session===navSession.current)navPosition.current=marker.position;
        navHref.current=workspaceHref();return;
      }
      const view=readWorkspaceRoute(config);
      const marker=window.history.state?.__protocoliaNavigation;
      const nextPosition=marker?.session===navSession.current?marker.position:null;
      if(navigationSnapshot.current?.saving&&
        view.resourceIndex!==navigationSnapshot.current.resourceIndex){
        // Never offer to "discard" a write that may already be committing.
        if(nextPosition!==null&&nextPosition!==navPosition.current){
          navRestoring.current=true;
          window.history.go(navPosition.current-nextPosition);
        }else if(navHref.current){
          window.history.replaceState({...window.history.state,
            __protocoliaNavigation:{session:navSession.current,position:navPosition.current}},
            "",navHref.current);
        }
        return;
      }
      if(navigationSnapshot.current?.createDirty&&
        view.resourceIndex!==navigationSnapshot.current.resourceIndex){
        setPendingNavigation({kind:"pop",view,previousPosition:navPosition.current,
          nextPosition,previousHref:navHref.current});
        setConfirmDiscard(true);return;
      }
      if(nextPosition!==null)navPosition.current=nextPosition;
      navHref.current=workspaceHref();applyWorkspaceRoute(view);
    };
    window.addEventListener("popstate",onPopState);
    return ()=>window.removeEventListener("popstate",onPopState);
  },[config]);
  useEffect(()=>{
    if(!active?.entity||pendingNavigation)return;
    resourceViews.current[active.entity.name]={offset,appliedFilters,draftFilters};
  },[active?.entity.name,offset,JSON.stringify(appliedFilters),JSON.stringify(draftFilters),pendingNavigation]);
  useEffect(()=>{
    if(!config||!active||pendingNavigation||navRestoring.current)return;
    const url=workspaceUrl(active,{offset,appliedFilters});
    if(url!==navHref.current){
      window.history.replaceState({...window.history.state,
        __protocoliaNavigation:{session:navSession.current,position:navPosition.current}},"",url);
      navHref.current=url;
    }
  },[config,active?.entity.name,offset,JSON.stringify(appliedFilters),pendingNavigation]);
  function commitCreateClose(){
    setConfirmDiscard(false);setActivePicker("");setCreating(false);
  }
  function discardAndNavigate(){
    const pending=pendingNavigation;
    commitCreateClose();setPendingNavigation(null);
    if(!pending)return;
    if(pending.kind==="push")pushWorkspaceRoute(pending.view);
    else{
      if(pending.nextPosition!==null)navPosition.current=pending.nextPosition;
      navHref.current=workspaceHref();applyWorkspaceRoute(pending.view);
    }
  }
  function closeCreate(){
    if(loading)return;
    if(confirmDiscard){returnToDraft();return;}
    if(createDirty){
      discardReturnFocus.current=document.activeElement;
      setConfirmDiscard(true);
      return;
    }
    setActivePicker("");setCreating(false);
  }
  function returnToDraft(){
    if(pendingNavigation?.kind==="pop"){
      const {previousPosition,nextPosition,previousHref}=pendingNavigation;
      if(nextPosition!==null&&previousPosition!==nextPosition){
        navRestoring.current=true;
        window.history.go(previousPosition-nextPosition);
      }else{
        // Unknown history is restored without guessing a browser-history delta.
        window.history.replaceState({...window.history.state,
          __protocoliaNavigation:{session:navSession.current,position:previousPosition}},
          "",previousHref);
        navPosition.current=previousPosition;navHref.current=previousHref;
      }
    }
    setPendingNavigation(null);setConfirmDiscard(false);
    requestAnimationFrame(()=>{
      const origin=discardReturnFocus.current;
      const fallback=document.querySelector('[data-testid^="create-form-"] [data-testid^="create-"]');
      (origin?.isConnected&&origin.closest('[data-testid="create-dialog"]')?origin:fallback)?.focus();
    });
  }
  useEffect(()=>{if(confirmDiscard&&creating)continueDraftButton.current?.focus();},[confirmDiscard,creating]);
  useEffect(()=>{
    if(!createDirty)return;
    const warn=event=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return ()=>window.removeEventListener("beforeunload",warn);
  },[createDirty]);
  // Compact, simple create tasks should not waste an entire mobile viewport.
  // Relationship selectors and longer workflows retain full-height dialogs.
  const compactCreate=Boolean(active?.entity?.fields&&
    active.entity.fields.filter(f=>!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal&&f.initial===undefined).length<=4&&
    !active.entity.fields.some(f=>!f.computedSum&&!f.computedProduct&&!f.computedRoundedProduct&&!f.computedDiscountedTotal&&f.initial===undefined&&f.reference));
  const referencesReady=active?.entity?.fields.filter(f=>f.reference)
    .every(f=>["ready","paged"].includes(referenceStatus[f.name]?.state))??true;
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
    const response=await authenticatedFetch(route(operation,code)+suffix,{
      method:operation.method,
      headers:{"Authorization":auth,...(body===undefined?{}:{"Content-Type":"application/json"})},
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
      const failure=Error(descriptions[response.status]??"Error HTTP "+response.status+" — "+kind);
      if(response.status===400&&Array.isArray(data.issues)){
        // Fail closed: never render arbitrary server-provided properties as field names or messages.
        const fields=new Set(active.entity.fields.map(field=>field.name));
        const allowed=new Set(["required","invalid_initial","invalid_format","invalid_choice","invalid_type","out_of_range","invalid_order","invalid_comparison"]);
        failure.issues=data.issues.filter(issue=>issue&&typeof issue==="object"&&
          fields.has(issue.field)&&allowed.has(issue.code)).map(issue=>({
          field:issue.field,code:issue.code
        }));
      }
      throw failure;
    }
    return data;
  }
  async function refresh(){
    if(!config||!auth)return;
    const epoch=++listRequestEpoch.current;
    setLoading(true);setError("");
    try{
      const args=listing();
      const data=await request(args.kind,{query:args.query});
      if(!Array.isArray(data.items))throw Error("Invalid paginated response");
      if(epoch===listRequestEpoch.current){setItems(data.items);setTotal(data.total);}
    }catch(e){if(epoch===listRequestEpoch.current)setError(e.message);}
    finally{if(epoch===listRequestEpoch.current)setLoading(false);}
  }
  useEffect(()=>{
    if(!active)return;
    listRequestEpoch.current++;
    setForm(createEmpty(active.entity.fields));setFieldErrors({});
    setSelected(null);setDetailOpen(false);setCreating(false);setActivePicker("");setItems([]);setReferenceOptions({});setReferenceStatus({});
    setAuditItems([]);setAuditTotal(0);setAuditOffset(0);setAuditError("");
    // Page and filters are preserved per resource and restored from route state.
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
          const response=await authenticatedFetch(target.operations.listPage.path+"?limit=50&offset=0",{
            headers:{Authorization:auth}
          });
          if(!response.ok)throw Error("No se pudo consultar "+field.reference.target+" (HTTP "+response.status+").");
          const result=await response.json();
          if(!Array.isArray(result.items)||!Number.isInteger(result.total)||
             result.total<result.items.length){
            throw Error("La selección de "+field.reference.target+
              " requiere búsqueda paginada (fuera del perfil actual).");
          }
          found[field.name]=result.items.map(item=>({
            key:item[target.entity.publicIdentity],
            displayName:item.name?String(item.name):String(item[target.entity.publicIdentity])
          }));
          statuses[field.name]={state:result.total>result.items.length?"paged":found[field.name].length?"ready":"empty",resourceLabel:target.view??label({name:target.entity.name}),target};
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
      setAuth("Basic "+candidate);
      setPassword("");
    }catch{
      setAuth("");setCapabilities([]);
      setLoginError("Credenciales incorrectas o servicio no disponible");
    }finally{setLoginBusy(false);}
  }
  async function startExternalLogin(){
    setLoginBusy(true);setLoginError("");
    try{await beginPkce(authConfig);}
    catch(error){setLoginError(error.message);setLoginBusy(false);}
  }
  function logOut(){
    listRequestEpoch.current++;
    setAuth("");setCapabilities([]);setPassword("");setSelected(null);setDetailOpen(false);setCreating(false);setActivePicker("");setItems([]);setError("");setNotice("");setAuditItems([]);setAuditOffset(0);setLoginError("");
  }
  async function act(kind,params){
    setError("");setNotice("");setLoading(true);
    try{
      const data=await request(kind,params);
      setSummaryRevision(x=>x+1);
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
    }catch(e){
      if(kind==="create"&&Array.isArray(e.issues)&&e.issues.length){
        const messages={
          required:"Este campo es obligatorio.",
          invalid_initial:"El valor inicial no está permitido.",
          invalid_format:"El formato ingresado no es válido.",
          invalid_choice:"La opción seleccionada no está permitida.",
          invalid_type:"El tipo de dato ingresado no es válido.",
          out_of_range:"El valor está fuera de los límites permitidos.",
          invalid_order:"La fecha no respeta el orden temporal requerido.",
          invalid_comparison:"El valor debe ser mayor que el campo de referencia."
        };
        const errors=Object.fromEntries(e.issues.map(issue=>[issue.field,messages[issue.code]]));
        setFieldErrors(errors);
        requestAnimationFrame(()=>{
          const field=document.querySelector('[data-testid="create-'+e.issues[0].field+'"]');
          field?.focus();
        });
      }
      setError(e.message);return null;
    }finally{setLoading(false);}
  }
  if(startupError)return <main><h1>Error de contrato</h1><p role="alert">{startupError}</p></main>;
  if(!config||!authConfig)return <main className="startup-loading"><LoadingIndicator message="Preparando aplicación…"/></main>;
  return <main className="shell">
    <header className="app-header">
      <div className="app-heading"><div className="app-eyebrow"><span className="brand-mark" aria-hidden="true">P</span>
        <span>ProtocolIA</span><span className="app-eyebrow-separator" aria-hidden="true">/</span><span>Espacio de trabajo</span></div>
        <h1>{active.view||active.entity.name}</h1>
        {auth&&<p className="app-heading-help">Consultá, organizá y gestioná tus registros.</p>}
      </div>
      {auth&&<button className="ghost logout-button" onClick={logOut}>Cerrar sesión</button>}
    </header>
    {!auth?<section className="panel login"><h2>Ingresar</h2>
      {loginError&&<p className="message error" role="alert">{loginError}</p>}
      {authConfig.mode==="jwt"?<>
        {authConfig.enabled?<button type="button" disabled={loginBusy}
          data-testid="login-provider" onClick={startExternalLogin}>
          {loginBusy?<LoadingIndicator message="Verificando identidad… " compact/>:"Ingresar con proveedor de identidad"}
        </button>:<p role="alert" className="message error">El inicio de sesión externo todavía no está configurado para esta aplicación.</p>}
      </>:<form onSubmit={logIn}><label className="field"><span>Usuario</span><input data-testid="username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required/></label>
      <label className="field"><span>Contraseña</span><input data-testid="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      <button type="submit" disabled={loginBusy}>{loginBusy?<LoadingIndicator message="Verificando… " compact/>:"Entrar"}</button></form>}</section>:
      <>
      {(config.resources??[]).filter(r=>r.operations.inboxPage).map(r=><NotificationInbox
        key={auth+":"+r.entity.name} operations={r.operations} auth={auth} capabilities={capabilities}/>)}
      {(config.resources?.length??0)>1&&<nav className="resource-nav" aria-label="Secciones de la aplicación">
        {config.resources.map((r,i)=><button key={r.entity.name}
          className={resourceIndex===i?"":"ghost"}
          aria-current={resourceIndex===i?"page":undefined}
          onClick={()=>selectResource(i)}>{r.view||r.entity.name}</button>)}
      </nav>}
      {error&&!selected&&!creating&&<p className="message error" role="alert">{error}</p>}
      {notice&&!selected&&!creating&&<p className="message" role="status">{notice}</p>}
      {can("queryPage")&&<details className="panel filters-panel" data-testid="query-filters">
        <summary className="filters-summary"><span className="filters-summary-title">Buscar y filtrar
          {Object.values(appliedFilters).filter(Boolean).length>0&&<span className="filter-counter">{Object.values(appliedFilters).filter(Boolean).length} activos</span>}
        </span><span className="filters-summary-hint">Mostrar filtros <span className="filters-chevron" aria-hidden="true">⌄</span></span></summary>
        <form className="filters-form" onSubmit={event=>{event.preventDefault();setOffset(0);setAppliedFilters({...draftFilters});}}> 
          <div className="fields">{searchFilters.map(filter=>{
            const source=active.entity.fields.find(f=>f.name===filter.parameter||(!filter.via&&f.name===filter.field));
            const caption=source?fieldLabel(source):label({name:filter.parameter});
            const inputType=source&&isMonthField(source)?"month":
              filter.type==="utcDateTime"?"datetime-local":filter.type==="int32"?"number":"text";
            const hintId=source?.uiHelp?"filter-"+filter.parameter+"-help":undefined;
            return <label className="field" key={filter.parameter}>
              <span>{caption}</span>
              <input aria-label={caption} aria-describedby={hintId} type={inputType} value={draftFilters[filter.parameter]??""}
                onChange={event=>setDraftFilters(old=>({...old,[filter.parameter]:event.target.value}))}/>
              {source?.uiHelp&&<span className="field-hint field-help-copy" id={hintId}>{source.uiHelp}</span>}
            </label>;
          })}
          </div>
          <div className="actions"><button type="submit">Filtrar</button>
            <button type="button" className="ghost" onClick={()=>{
              setDraftFilters({});setOffset(0);setAppliedFilters({});}}>Limpiar filtros</button>
          </div>
        </form>
      </details>}
      <section className="panel records-panel">
        <div className="heading records-heading"><div><h2 ref={listHeading} tabIndex={-1}>Registros <span className="record-count">{total}</span></h2><p className="panel-helper">Toda la información, en un solo lugar.</p></div><div className="toolbar">
          {can("create")&&<button data-testid="open-create" onClick={event=>{createOpener.current=event.currentTarget;setForm(createEmpty(active.entity.fields));setFieldErrors({});setError("");setConfirmDiscard(false);setCreating(true);}}>Nuevo registro</button>}
          <button className="ghost" onClick={refresh}>Actualizar</button></div></div>
        {loading&&<div className="list-loading"><LoadingIndicator message="Actualizando registros…"/></div>}
        <div className="scroll data-table-scroll"><table className="data-table"><thead><tr>{tableColumns.map(f=><th key={f.name} scope="col">{fieldLabel(f)}</th>)}<th scope="col" className="table-action">Acción</th></tr></thead>
        <tbody>{items.map(item=><tr key={item[active.entity.publicIdentity]}>
          {tableColumns.map(f=><td key={f.name}>{displayCell(f,item[f.name],referenceOptions)}</td>)}
          <td className="table-action"><button className="ghost" data-testid={"open-detail-"+item[active.entity.publicIdentity]} onClick={event=>{detailOpener.current=event.currentTarget;setError("");setNotice("");setAuditOffset(0);setSelected(item);setDetailOpen(true);setRename(String(operations.patchFields?item[operations.patchFields.behavior.field]??"": ""));setReassigned(String(operations.reassignReference?item[operations.reassignReference.behavior.field]??"":""));}}>Detalle</button></td>
        </tr>)}</tbody></table></div>
        {items.length===0&&!loading&&<div className="empty-state" role="status">
          <span className="empty-state-illustration" aria-hidden="true">⌕</span>
          <strong>{Object.values(appliedFilters).some(Boolean)?"Sin resultados para estos filtros":"Todavía no hay registros"}</strong>
          <span>{Object.values(appliedFilters).some(Boolean)?"Probá con otros criterios o limpiá los filtros.":"Los registros que crees van a aparecer acá."}</span>
        </div>}
        <div className="paging"><button className="ghost" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Anterior</button>
          <span>{total===0?0:offset+1}–{Math.min(offset+limit,total)} de {total}</span>
          <button className="ghost" disabled={offset+limit>=total} onClick={()=>setOffset(offset+limit)}>Siguiente</button></div>
      </section>
      <Dialog.Root open={creating} onOpenChange={open=>{if(!loading){setCreating(open);if(!open)setActivePicker("");}}}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay"/>
          <Dialog.Content className={compactCreate?"modal-content modal-content-compact":"modal-content"} aria-modal={true} aria-describedby={undefined} data-testid="create-dialog"
            onEscapeKeyDown={event=>{
              if(activePicker){event.preventDefault();setActivePicker("");}
              else if(createDirty||confirmDiscard){event.preventDefault();closeCreate();}
            }}
            onInteractOutside={event=>{
              if(createDirty||confirmDiscard){event.preventDefault();closeCreate();}
            }}
            onCloseAutoFocus={event=>{if(createOpener.current?.isConnected){event.preventDefault();createOpener.current.focus();}}}>
            <div className="modal-header"><div><Dialog.Title className="modal-title">{confirmDiscard?"¿Descartar los cambios?":"Nuevo registro"}</Dialog.Title>
              <Dialog.Description className="modal-description">{confirmDiscard?
                pendingNavigation?"Para cambiar de sección, primero tenés que descartar los cambios sin guardar.":"Si descartás el borrador, se perderán los datos que todavía no guardaste.":
                "Completá los datos para agregarlo al listado."}</Dialog.Description></div>
              <Dialog.Close asChild><button type="button" className="icon-button" aria-label="Cerrar creación" disabled={loading}
                onClick={event=>{if(createDirty||confirmDiscard){event.preventDefault();closeCreate();}}}><span aria-hidden="true">×</span></button></Dialog.Close></div>
            <div className="modal-scroll">
              {confirmDiscard?<div className="draft-discard-panel" data-testid="unsaved-changes-confirmation">
                <div className="draft-discard-illustration" aria-hidden="true">!</div>
                <h3>Hay cambios sin guardar</h3>
                <p>{pendingNavigation?"Podés seguir editando, o descartar el borrador y continuar con la navegación.":"Podés seguir editando sin perder nada, o descartar este borrador para volver al listado."}</p>
                <div className="modal-actions">
                  <button type="button" className="ghost" ref={continueDraftButton} onClick={returnToDraft}>Seguir editando</button>
                  <button type="button" className="discard-button" onClick={discardAndNavigate}>Descartar cambios</button>
                </div>
              </div>:<>
              {error&&<p className="message error" role="alert">{error}</p>}
        <form noValidate data-testid={"create-form-"+active.entity.name} onSubmit={async event=>{event.preventDefault();
          if(!referencesReady){setError("Esperá a que estén disponibles las opciones relacionadas.");return;}
          const errors=validateCreate(active.entity.fields,form,operations.reconcileExact?.behavior?.reconcileExact);
          setFieldErrors(errors);
          if(Object.keys(errors).length){
            setError("Revisá los campos marcados para continuar.");
            const invalid=Object.keys(errors)[0];
            event.currentTarget.querySelector(`[data-testid="create-${invalid}"]`)?.focus();
            return;
          }
          const data=await act("create",{body:normalizePayload(active.entity.fields,form)});
          if(data){setForm(createEmpty(active.entity.fields));setFieldErrors({});commitCreateClose();}
        }}><div className="form-groups">{groupCreateFields(active.entity.fields).map((group,index)=>
          <section className="form-section" key={group.title??"ungrouped"} data-testid={"create-section-"+index}
            aria-label={group.title??"Datos del registro"}>
            {group.title&&<h3 className="form-section-title">{group.title}</h3>}
            <div className="fields">{group.fields.map(field=><FormField key={field.name} field={field} value={form[field.name]} choices={referenceOptions[field.name]}
          required={isRequiredInForm(field,form)}
          conditionallyRequired={Boolean(field.requiredWhen&&form[field.requiredWhen.field]===field.requiredWhen.equals)}
          referenceState={referenceStatus[field.name]} validationError={fieldErrors[field.name]}
           auth={auth} onReferenceResolve={(name,choice)=>setReferenceOptions(prev=>{
             const entries=prev[name]??[];
             if(entries.some(item=>String(item.key)===String(choice.key)&&item.displayName===choice.displayName))return prev;
             return {...prev,[name]:[choice,...entries.filter(x=>String(x.key)!==String(choice.key))].slice(0,60)};
           })}
          pickerOpen={activePicker===field.name}
          onPickerOpenChange={open=>setActivePicker(open?field.name:"")}
          onChange={(name,value)=>{setForm(prev=>({...prev,[name]:value}));setFieldErrors(prev=>{const updated={...prev};delete updated[name];for(const f of active.entity.fields)if(f.requiredWhen?.field===name||f.forbidWhen?.field===name||f.greaterThanField===name||f.afterField===name)delete updated[f.name];return updated;});}}/>)}</div>
          </section>)}</div>
          <div className="modal-actions"><button type="button" className="ghost" onClick={closeCreate} disabled={loading}>Cancelar</button>
          <button type="submit" disabled={loading||!referencesReady}>{loading?"Guardando…":"Crear"}</button></div></form></>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={detailOpen} onOpenChange={open=>{if(!loading){setDetailOpen(open);if(!open)setActivePicker("");}}}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay"/>
          {selected&&<Dialog.Content data-testid="detail-dialog" aria-modal={true} className="modal-content"
            aria-describedby={undefined}
            onEscapeKeyDown={event=>{if(activePicker){event.preventDefault();setActivePicker("");}}}
            onCloseAutoFocus={event=>{event.preventDefault();
              const origin=detailOpener.current?.isConnected?detailOpener.current:listHeading.current;
              origin?.focus();setSelected(null);
            }}>
            <div className="modal-header"><div><p className="modal-kicker">Información del registro</p>
              <Dialog.Title className="modal-title">Detalle: {selected[active.entity.publicIdentity]}</Dialog.Title></div>
              <Dialog.Close asChild><button type="button" className="icon-button" aria-label="Cerrar detalle" disabled={loading}><span aria-hidden="true">×</span></button></Dialog.Close></div>
            <div className="modal-scroll">
            {error&&<p className="message error" role="alert">{error}</p>}
            {notice&&<p className="message" role="status">{notice}</p>}
        {canReconcile&&<LedgerReconciliationPanel
          key={active.entity.name+":"+selected[active.entity.publicIdentity]}
          operation={ledgerReconciliation}
          identity={selected[active.entity.publicIdentity]}
          auth={auth} child={ledgerChild} revision={summaryRevision}/>}
        {canReadRelatedSum&&<RelatedSumPanel
          key={active.entity.name+":"+selected[active.entity.publicIdentity]}
          operation={relatedSum}
          identity={selected[active.entity.publicIdentity]}
          auth={auth}
          child={relatedSumChild}
          revision={summaryRevision}/>}
        <div className="details-section"><h3>Datos generales</h3>
          <dl>{active.entity.fields.filter(field=>!field.readCapability||capabilities.includes(field.readCapability)).map(field=><React.Fragment key={field.name}><dt>{fieldLabel(field)}</dt><dd>{displayCell(field,selected[field.name],referenceOptions)}</dd></React.Fragment>)}</dl>
        </div>
        <div className="actions record-actions">
          {can("patchFields")&&<form onSubmit={e=>{e.preventDefault();act("patchFields",{code:selected[active.entity.publicIdentity],body:{[operations.patchFields.behavior.input]:rename}});}}>
            <label className="field"><span>Modificar {operations.patchFields.behavior.field}</span><input data-testid="rename" value={rename} onChange={e=>setRename(e.target.value)}/></label>
            <button type="submit" disabled={loading}>Guardar cambios</button></form>}
          {can("reassignReference")&&<form data-testid="reassign-reference" onSubmit={e=>{
              e.preventDefault();
              const field=operations.reassignReference.behavior.field;
              act("reassignReference",{code:selected[active.entity.publicIdentity],
                body:{expected:selected[field],[field]:reassigned}});
            }}>
            <div className="detail-action-block">
              <h3>Cambiar {fieldLabel(active.entity.fields.find(f=>f.name===operations.reassignReference.behavior.field)??{name:operations.reassignReference.behavior.field}).toLowerCase()}</h3>
              <p className="field-help">Elegí un destino y confirmá el cambio. La asignación anterior queda registrada.</p>
              <FormField
                field={active.entity.fields.find(f=>f.name===operations.reassignReference.behavior.field)}
                value={reassigned}
                choices={referenceOptions[operations.reassignReference.behavior.field]}
                referenceState={referenceStatus[operations.reassignReference.behavior.field]}
                 auth={auth} onReferenceResolve={(name,choice)=>setReferenceOptions(prev=>{
                   const entries=prev[name]??[];
                   if(entries.some(item=>String(item.key)===String(choice.key)&&item.displayName===choice.displayName))return prev;
                   return {...prev,[name]:[choice,...entries.filter(x=>String(x.key)!==String(choice.key))].slice(0,60)};
                 })}
                pickerOpen={activePicker===operations.reassignReference.behavior.field}
                onPickerOpenChange={open=>setActivePicker(open?operations.reassignReference.behavior.field:"")}
                onChange={(name,value)=>setReassigned(value)}
              />
              <button data-testid="confirm-reassign" type="submit" disabled={loading||
                !["ready","paged"].includes(referenceStatus[operations.reassignReference.behavior.field]?.state)||
                !reassigned||reassigned===selected[operations.reassignReference.behavior.field]}>
                {loading?"Guardando…":"Confirmar cambio"}
              </button>
            </div>
          </form>}
          {can("atomicIncrement")&&<form onSubmit={e=>{e.preventDefault();act("atomicIncrement",{code:selected[active.entity.publicIdentity],body:{[operations.atomicIncrement.behavior.input]:Number(increment)}});}}>
            <label className="field"><span>Incrementar {label({name:operations.atomicIncrement.behavior.field})}</span><input data-testid="increment" type="number" min={1} value={increment} onChange={e=>setIncrement(e.target.value)}/></label>
            <button type="submit" disabled={loading}>Incrementar</button></form>}
          {transitions.filter(op=>capabilities.includes(op.capability) &&
            selected[op.behavior.field]===op.behavior.from).map(op=>
            <button type="button" className="ghost generated-state-action" key={op.name} data-testid={"transition-"+op.name}
              disabled={loading} onClick={()=>act(op.name,{code:selected[active.entity.publicIdentity]})}>
              <span>{transitionLabel(op)}</span>
              <span className="generated-state-target">Estado nuevo: {cellText(op.behavior.to)}</span>
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
