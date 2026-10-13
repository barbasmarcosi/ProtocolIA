/** Fail closed on schema/manifest drift. No domain fields declared in React. */
import schemaDoc from '../../contract-bundle/payload.schema.json';
import uiDoc from '../../contract-bundle/ui-manifest.json';
import type { RJSFSchema, UiSchema } from '@rjsf/utils';
import type { Book } from '../generated/orval/models';

export type View = {
  title: string; model: string; schemaRef: string; operationId: string;
  fields: string[];
};
type Resource = {
  model: string; identityField:string;
  operations:{list:string;detail:string;create:string; actions:Record<string,string>};
  views:Record<string,View>;
  invalidates:Record<string,string[]>;
};
const schemaRoot = schemaDoc as unknown as { $schema:string; $defs:Record<string,RJSFSchema> };
const ui = uiDoc as unknown as {version:string;resources:Record<string,Resource>};
export const books = ui.resources?.books;

function fail(reason:string):never {throw new Error('PROTOCOLIA_G3_MANIFEST_DRIFT: '+reason);}
if(!books||books.model!=='Book'||books.identityField!=='isbn')fail('resource identity');
if(books.operations.create!=='createBook'||books.operations.detail!=='getBook'||
  books.operations.list!=='listBooks'||books.operations.actions?.restock!=='adjustStock')fail('operation bindings');
if(schemaRoot.$schema!=='https://json-schema.org/draft/2020-12/schema')fail('unsupported JSON Schema draft');
for(const [role,model] of Object.entries({list:'Book',detail:'Book',create:'BookRequest',restock:'StockAdjustment',rename:'TitleChange'})){
  const view=books.views?.[role];
  if(!view||view.model!==model||view.schemaRef!=='#/$defs/'+model||
    !Array.isArray(view.fields)||!view.fields.length)fail('missing or untrusted '+role+' view');
  const src=schemaRoot.$defs[model];
  if(!src||src.type!=='object'||!src.properties)fail('missing schema '+model);
  for(const key of view.fields)if(!Object.hasOwn(src.properties,key))fail('field not in contract '+key);
}
if(JSON.stringify(books.invalidates?.createBook)!=='["books"]' ||
 JSON.stringify(books.invalidates?.adjustStock)!=='["books"]')fail('write invalidation rules');

export const labelFor = (name:string)=>({
  isbn:'ISBN',title:'Título',stock:'Existencias',quantity:'Unidades',total:'Total',
  limit:'Límite',offset:'Desplazamiento',publishedAt:'Fecha de publicación'
} as Record<string,string>)[name]??name;

export const getView=(role:'list'|'detail'|'create'|'restock'|'rename')=>books.views[role];
export const listFields=getView('list').fields as (keyof Book)[];

export function formSchema(role:'create'|'restock'|'rename'):RJSFSchema {
 const view=getView(role);
 const src=schemaRoot.$defs[view.model];
 // The generated JSON Schema, not a handwritten field list, defines validation.
 return {...src,$defs:schemaRoot.$defs,$schema:schemaRoot.$schema};
}
export function formUiSchema(role:'create'|'restock'):UiSchema {
 const view=getView(role);
 const schema:UiSchema={'ui:order':view.fields};
 for(const key of view.fields)schema[key]={'ui:title':labelFor(key)};
 return schema;
}
