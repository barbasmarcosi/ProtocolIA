import schemaDoc from '../../contract-bundle/payload.schema.json';
import uiDoc from '../../contract-bundle/ui-manifest.json';
import type {RJSFSchema,UiSchema} from '@rjsf/utils';
import type {Tool} from '../generated/orval/models';
export type View={title:string;model:string;schemaRef:string;operationId:string;fields:string[]};
type Resource={model:string;identityField:string;operations:{list:string;detail:string;create:string;actions:Record<string,string>};views:Record<string,View>;invalidates:Record<string,string[]>};
const doc=schemaDoc as unknown as {$schema:string;$defs:Record<string,RJSFSchema>};
const manifest=uiDoc as unknown as {resources:Record<string,Resource>};
export const tools=manifest.resources?.tools;
function fail(s:string):never{throw Error('PROTOCOLIA_TALLER_DRIFT: '+s);}
if(!tools||tools.model!=='Tool'||tools.identityField!=='code')fail('identity');
if(tools.operations.create!=='createTool'||tools.operations.list!=='listTools'||
 tools.operations.detail!=='getTool'||tools.operations.actions?.restock!=='increaseQuantity'||
 tools.operations.actions?.rename!=='renameTool')fail('roles');
if(doc.$schema!=='https://json-schema.org/draft/2020-12/schema')fail('schema draft');
for(const [role,model] of Object.entries({list:'Tool',detail:'Tool',create:'ToolRequest',restock:'QuantityAdjustment',rename:'ToolNameChange'})){
 const view=tools.views?.[role],schema=doc.$defs[model];
 if(!view||view.model!==model||view.schemaRef!=='#/$defs/'+model||!view.fields?.length||!schema?.properties)fail(role);
 for(const key of view.fields)if(!Object.hasOwn(schema.properties,key))fail('field '+key);
}
for(const key of ['createTool','increaseQuantity','renameTool']){
 if(JSON.stringify(tools.invalidates[key])!=='["tools"]')fail('invalidation '+key);
}
export const labelFor=(name:string)=>({
 code:'Código',name:'Nombre',quantity:'Existencias',amount:'Unidades a agregar',
 lastReviewedAt:'Última revisión',limit:'Límite',offset:'Desplazamiento',total:'Total'
} as Record<string,string>)[name]??name;
export const getView=(role:'list'|'detail'|'create'|'restock'|'rename')=>tools.views[role];
export const listFields=getView('list').fields as (keyof Tool)[];
export function formSchema(role:'create'|'restock'|'rename'):RJSFSchema{
 const view=getView(role);return {...doc.$defs[view.model],$defs:doc.$defs,$schema:doc.$schema};
}
export function formUiSchema(role:'create'|'restock'|'rename'):UiSchema{
 const view=getView(role),schema:UiSchema={'ui:order':view.fields};
 for(const key of view.fields)schema[key]={'ui:title':labelFor(key)};
 return schema;
}
