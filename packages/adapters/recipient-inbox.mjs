/** Recipient-scoped operations: trusted authenticated issuer/subject, never client recipient input. */
const kinds=new Set(['inboxPage','ackNotification']);
const ident=v=>{if(typeof v!=='string'||!/^[A-Za-z][A-Za-z0-9_]*$/.test(v))throw Error('Unsafe recipient identifier');return v;};
const snake=v=>ident(v).replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase();
export function compileRecipientInboxes(ir){
 const result=[];
 const ordinaryCaps=new Set(ir.operations.filter(o=>!kinds.has(o.behavior.kind)).map(o=>o.capability));
 for(const entity of ir.entities){
  const ops=ir.operations.filter(o=>o.entity===entity.name&&kinds.has(o.behavior.kind));
  if(!ops.length&&!entity.recipientIdentity)continue;
  const key=entity.fields.find(f=>f.name===entity.publicIdentity);
  const page=ops.filter(o=>o.behavior.kind==='inboxPage'),ack=ops.filter(o=>o.behavior.kind==='ackNotification');
  const rules=ir.entities.filter(e=>e.overdueAlert&&e.fields.find(f=>f.name===e.overdueAlert.recipientField)?.reference?.target===entity.name).map(e=>ident(e.name)+'.overdue');
  const table=snake(entity.name),bindingTable='protocolia_identity_'+table;
  if(entity.recipientIdentity!==true||!key||key.type!=='string'||!key.unique||!key.required||key.nullable||
    page.length!==1||ack.length!==1||!rules.length||('protocolia_inbox_'+table+'_page').length>63)
    throw Error('Recipient inbox requires explicit identity, one page/ack pair and overdue source rules');
  for(const op of ops){
   const read=op.behavior.kind==='inboxPage';
   if(op.path!=='/api/notifications/'+table+(read?'':'/{notificationId}/ack')||
      op.method!==(read?'GET':'POST')||op.request||Object.keys(op.behavior).some(k=>k!=='kind')||
      ![200,400,401,403,...(read?[]:[404])].every(s=>op.statuses?.includes(s))||
      typeof op.capability!=='string'||!/^[_a-zA-Z][_a-zA-Z0-9.:-]{0,127}$/.test(op.capability)||
      op.capability==='public'||ordinaryCaps.has(op.capability))
     throw Error('Invalid independently authorized recipient inbox operation '+op.name);
  }
  if(page[0].capability===ack[0].capability)throw Error('Inbox read and acknowledgement permissions must differ');
  result.push({entity:entity.name,table,identityColumn:snake(entity.publicIdentity),bindingTable,rules,
    readCapability:page[0].capability,ackCapability:ack[0].capability});
 }
 // Prevent a permission granting read in one domain from granting writes in another.
 if(result.some(a=>result.some(b=>a.readCapability===b.ackCapability)))throw Error('Ambiguous inbox permissions');
 if(ir.operations.some(o=>kinds.has(o.behavior.kind)&&!result.some(r=>r.entity===o.entity)))
  throw Error('Unresolved inbox recipient');
 return result;
}
export function assertInboxOpenApi(spec,op){
 if(!kinds.has(op.behavior.kind))return;
 const resolve=v=>v?.$ref?v.$ref.split('/').slice(1).reduce((a,k)=>a?.[k],spec):v;
 const http=spec.paths?.[op.path]?.[op.method.toLowerCase()];
 const params=(http?.parameters??[]).map(resolve);
 if(!http||http.requestBody)throw Error('Invalid inbox HTTP binding');
 if(op.behavior.kind==='inboxPage'){
  if(params.length!==2)throw Error('Inbox accepts only bounded limit and offset');
  for(const [key,min,max,def] of [['limit',1,50,25],['offset',0,1000000,0]]){
   const p=params.find(p=>p.name===key&&p.in==='query');const s=resolve(p?.schema);
   if(!s||s.type!=='integer'||s.minimum!==min||s.maximum!==max||s.default!==def||p.required)
    throw Error('Invalid inbox pagination contract');
  }
 }else if(params.length!==1||params[0].name!=='notificationId'||params[0].in!=='path'||resolve(params[0].schema)?.type!=='string')
  throw Error('Invalid inbox acknowledgement identity');
}
export function recipientInboxSql(inboxes){
 return inboxes.flatMap(r=>{
  const prefix='protocolia_inbox_'+r.table;
  const rules=r.rules.map(k=>"'"+k+"'").join(',');
  const binding=`  SELECT b.recipient_key INTO recipient FROM ${r.bindingTable} b
    WHERE b.issuer=p_issuer AND b.subject=p_subject FOR SHARE;
  IF recipient IS NULL THEN RAISE EXCEPTION 'Recipient identity is not provisioned' USING ERRCODE='42501'; END IF;`;
  const item=`jsonb_build_object('id',i.outbox_id::text,'ruleKey',i.rule_key,
    'entityName',o.entity_name,'resourceId',i.resource_id,'recipientKey',i.recipient_key,
    'eventAt',o.due_at,'notifiedAt',i.notified_at,'readAt',i.read_at)`;
  const scope=`i.recipient_key=recipient AND i.rule_key IN (${rules})`;
  return [
`CREATE TABLE ${r.bindingTable} (
 issuer VARCHAR(255) NOT NULL CHECK (length(trim(issuer))>0),
 subject VARCHAR(255) NOT NULL CHECK (length(trim(subject))>0),
 recipient_key VARCHAR(255) NOT NULL REFERENCES ${r.table}(${r.identityColumn}) ON DELETE RESTRICT,
 provisioned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (issuer,subject), UNIQUE (issuer,recipient_key));`,
`REVOKE ALL ON TABLE ${r.bindingTable} FROM PUBLIC;`,
`CREATE OR REPLACE FUNCTION ${prefix}_page(p_issuer TEXT,p_subject TEXT,p_limit INTEGER,p_offset INTEGER)
RETURNS JSONB AS $pia$
DECLARE recipient TEXT; result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 OR p_offset IS NULL OR p_offset<0 OR p_offset>1000000 THEN
    RAISE EXCEPTION 'Invalid inbox page bounds' USING ERRCODE='22023'; END IF;
${binding}
  SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(x.item ORDER BY x.id DESC) FROM (
      SELECT i.outbox_id AS id,${item} AS item FROM protocolia_notification_inbox i
      JOIN protocolia_notification_outbox o ON o.id=i.outbox_id WHERE ${scope}
      ORDER BY i.outbox_id DESC LIMIT p_limit OFFSET p_offset) x),'[]'::jsonb),
    'total',(SELECT count(*) FROM protocolia_notification_inbox i WHERE ${scope}),
    'limit',p_limit,'offset',p_offset) INTO result;
  RETURN result;
END; $pia$ LANGUAGE plpgsql;`,
`CREATE OR REPLACE FUNCTION ${prefix}_ack(p_issuer TEXT,p_subject TEXT,p_id BIGINT)
RETURNS JSONB AS $pia$
DECLARE recipient TEXT; result JSONB;
BEGIN
  IF p_id IS NULL OR p_id<1 THEN RAISE EXCEPTION 'Invalid notification id' USING ERRCODE='22023'; END IF;
${binding}
  UPDATE protocolia_notification_inbox i SET read_at=COALESCE(i.read_at,CURRENT_TIMESTAMP)
    WHERE i.outbox_id=p_id AND ${scope};
  IF NOT FOUND THEN RAISE EXCEPTION 'Notification not found' USING ERRCODE='P0002'; END IF;
  SELECT ${item} INTO result FROM protocolia_notification_inbox i
    JOIN protocolia_notification_outbox o ON o.id=i.outbox_id WHERE i.outbox_id=p_id AND ${scope};
  RETURN result;
END; $pia$ LANGUAGE plpgsql;`,
`REVOKE ALL ON FUNCTION ${prefix}_page(TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC;`,
`REVOKE ALL ON FUNCTION ${prefix}_ack(TEXT,TEXT,BIGINT) FROM PUBLIC;`
 ];
 });
}
