import {useState} from 'react';
import Form from '@rjsf/core';
import type {RJSFSchema} from '@rjsf/utils';
import {formSchema,formUiSchema,getView} from '../../protocolia-ui/bindings';
import {validator} from '../../protocolia-ui/validator';

type Props={role:'create'|'restock';pending:boolean;onValid:(data:Record<string,unknown>)=>Promise<void>};

export function SchemaBookForm({role,pending,onValid}:Props){
 const [revision,setRevision]=useState(0);
 const [formError,setFormError]=useState('');
 const view=getView(role);
 return <section className="form-panel">
  <h3>{view.title}</h3>
  <p className="subtle small">Campos y reglas desde JSON Schema 2020-12.</p>
  <Form key={role+'-'+revision}
    schema={formSchema(role) as RJSFSchema}
    uiSchema={formUiSchema(role)}
    validator={validator}
    showErrorList={false}
    noHtml5Validate
    disabled={pending}
    liveValidate
    customValidate={(data,errors)=>{
      for(const key of ['isbn','title']){
        const val=(data as Record<string,unknown>)?.[key];
        if(typeof val==='string'&&!val.trim()){
          errors[key]?.addError('No puede contener solo espacios.');
        }
      }
      return errors;
    }}
    onSubmit={async ({formData})=>{
      setFormError('');
      try{
        await onValid(formData as Record<string,unknown>);
        setRevision(n=>n+1);
      }catch(e){
        setFormError(e instanceof Error?e.message:'No se pudo guardar');
      }
    }}>
    <button type="submit" className="primary" disabled={pending}>{pending?'Guardando…':role==='create'?'Crear libro':'Aplicar reposición'}</button>
  </Form>
  {formError&&<p className="error" role="alert">{formError}</p>}
 </section>;
}
