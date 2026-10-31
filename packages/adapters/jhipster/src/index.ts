/**
 * Adapter projection from the technology-neutral ProtocolIA IR.
 * A JDL entity is ONLY a persistence/CRUD scaffold, not a faithful HTTP/domain app.
 */
export interface IrField {
  name: string;
  ownerManaged?: boolean;
  readCapability?: string;
  type: "string" | "int32" | "utcDateTime" | "decimal";
  required: boolean;
  nullable: boolean;
  unique: boolean;
  min?: number;
  max?: number;
  /** Exact decimal semantic constraints; values never pass through JS Number. */
  decimal?: {precision:number;scale:number;min?:string;max?:string};
  minLength?: number;
  maxLength?: number;
  /** Portable authoritative year-month pattern from standard TypeSpec. */
  pattern?: string;
  /** Source-declared TypeSpec string enum values and display labels; not arbitrary UI hints. */
  choices?: Array<{value:string;label:string}>;
  /** A sibling enum and value that conditionally require this otherwise-optional field. */
  requiredWhen?: {field:string;equals:string};
  forbidWhen?: {field:string;equals:string};
  /** Portable strict chronological order after a required sibling. */
  afterField?: string;
  /** Strict ordering against a required sibling int32 or exact decimal; scales may differ. */
  greaterThanField?: string;
  reference?: {target: string; onDelete: "restrict"};
  initial?: string;
  computedSum?: string[];
  /** Database-generated exact product of two required source decimals. */
  computedProduct?: [string,string];
  /** Exact decimal multiplication rounded at the output scale with an explicit mode. */
  computedRoundedProduct?: {left:string;right:string;mode:"half_up"};
  /** Total = round(price * quantity * (100 - discount)/100, scale). */
  computedDiscountedTotal?: {price:string;quantity:string;discount:string;mode:"half_up"};
  /** Display-only hints. Domain semantics and server validations remain authoritative. */
  uiLabel?: string;
  uiHelp?: string;
  uiControl?: "month" | "textarea";
  /** Presentation-only grouping of editable inputs. */
  uiSection?: string;
  /** Sample text only; never persisted as a default. */
  uiPlaceholder?: string;
}
export interface IrEntity {
  name: string;
  /** Compound business identity invariant enforced atomically by PostgreSQL. */
  uniqueTogether?: string[];
  /** PostgreSQL partial uniqueness for one declared terminal-intermediate state. */
  uniqueWhen?: {fields:string[];stateField:string;activeState:string};
  publicIdentity: string;
  fields: IrField[];
  view?: string;
  recipientIdentity?: boolean;
  overdueAlert?: {
    dueField:string;stateField:string;terminalState:string;recipientField:string;channel:"inbox";
  };
}
export interface IrOperation {
  name: string;
  entity: string;
  method: string;
  path: string;
  behavior: {
    kind: "create" | "get" | "listPage" | "patchFields" | "patchTogether" | "atomicIncrement" | "transition" | "reassignReference" | "queryPage" | "auditPage" | "inboxPage" | "ackNotification" | "sumRelated" | "sumDetails" | "reconcileExact" | "replaceDetails" | "delete" | "health";
    field?: string;
    input?: string;
    from?: string;
    to?: string;
    reserve?: {stockEntity: string; availableField: string; referenceField: string; quantityField: string};
    moveUnits?: {stockEntity:string;availableField:string;sourceField:string;targetField:string;quantityField:string};
    moveBatch?: {stockEntity:string;availableField:string;legs:{sourceField:string;targetField:string;quantityField:string}[]};
    createDetails?: {childEntity:string;parentField:string;rowsField:string;maxRows:number;
      versioned?:boolean;closeField?:string;closeState?:string;
      chargeAmountField?:string;chargeTotalField?:string};
    detailSum?: {childEntity:string;parentField:string;quantityField:string};
    reverseBatch?: {stockEntity:string;availableField:string;legs:{sourceField:string;targetField:string;quantityField:string}[]};
    reverseUnits?: {stockEntity:string;availableField:string;sourceField:string;targetField:string;quantityField:string};
    debitExact?: {stockEntity: string; availableField: string; referenceField: string; quantityField: string};
    reverseExact?: {stockEntity: string; availableField: string; referenceField: string; quantityField: string};
    relatedSum?: {childEntity:string;referenceField:string;quantityField:string;stateField:string;activeState:string};
    reconcileExact?: {openingField:string;availableField:string;childEntity:string;referenceField:string;amountField:string;stateField:string;postedState:string;reversedState:string;chargeSource?:string;chargeSources?:string[];serverOnly?:boolean;lifecycle?:boolean;adjustmentPreview?:boolean};
    release?: {stockEntity: string; availableField: string; referenceField: string; quantityField: string};
    audit?: string[];
    filters?: {parameter:string;field:string;via?:string;operator:"eq"|"gte"|"lte"|"contains";type:IrField["type"]}[];
    sort?: {field:string;direction:"asc"|"desc"};
  };
  capability: string;
  request?: string;
  statuses: number[];
}
export interface IrDocument {
  irVersion: "vnext-a0.1";
  namespace: string;
  entities: IrEntity[];
  operations: IrOperation[];
}
export interface AdapterDecision {
  adapter: "jhipster-spring";
  generatorVersion: "9.4.0";
  canEmitJdl: boolean;
  fullContractSupported: boolean;
  blockers: Array<{ code: string; operation?: string; detail: string }>;
}

function identifier(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("Unsafe JDL identifier: " + JSON.stringify(value));
  }
  return value;
}
function fieldToJdl(field: IrField): string {
  if (field.nullable && field.required) {
    throw new Error("JDL cannot express a required-but-nullable field: " + field.name);
  }
  const kind: Record<IrField["type"], string> = {
    string: "String", int32: "Integer", utcDateTime: "Instant", decimal: "BigDecimal",
  };
  const parts = [identifier(field.name), kind[field.type]];
  if (field.required) parts.push("required");
  if (field.unique) parts.push("unique");
  if (field.minLength !== undefined) parts.push("minlength(" + field.minLength + ")");
  if (field.maxLength !== undefined) parts.push("maxlength(" + field.maxLength + ")");
  if (field.min !== undefined) parts.push("min(" + field.min + ")");
  if (field.max !== undefined) parts.push("max(" + field.max + ")");
  return "  " + parts.join(" ");
}
export function emitJdl(ir: IrDocument): string {
  if (ir.irVersion !== "vnext-a0.1") throw new Error("Unsupported IR version");
  // JDL cannot express the external identity; it is retained in the IR.
  return ir.entities.map((entity) => {
    const key = entity.fields.find((x) => x.name === entity.publicIdentity);
    if (!key || !key.required || key.nullable || !key.unique) {
      throw new Error("Invalid public identity: " + entity.name + "." + entity.publicIdentity);
    }
    return "entity " + identifier(entity.name) + " {\n" +
      entity.fields.map(fieldToJdl).join("\n") + "\n}\n\npaginate " +
      identifier(entity.name) + " with pagination\n";
  }).join("\n");
}
/**
 * Explicit capability negotiation. JHipster stock controllers operate on numeric
 * internal ids, default endpoints and pagination; JDL cannot describe behavior,
 * business capabilities or the contract-facing public identity.
 *
 * Do not pass this plan to an application generator while blockers exist.
 */
export function planJhipster(ir: IrDocument): AdapterDecision {
  const blockers: AdapterDecision["blockers"] = [];
  for (const entity of ir.entities) {
    blockers.push({
      code: "PUBLIC_IDENTITY_ADAPTER_UNVERIFIED",
      detail: entity.name + "." + entity.publicIdentity +
        " must replace JHipster's numeric-id HTTP/React surface through reusable extension",
    });
  }
  for (const op of ir.operations) {
    const detail: Record<IrOperation["behavior"]["kind"], string> = {
      create: "Contractual POST body/201/409/capability not proven on generated endpoint, including transactional reserve+insert where declared",
      get: "Contractual GET by public identity/404/capability not proven",
      listPage: "Contract uses limit/offset and a page object, not JHipster default pageable response",
      queryPage: "Typed relationship-aware filtered pagination is not generated by stock JHipster",
      sumRelated: "Authorized aggregate of active child records requires a generic extension",
      sumDetails: "Authorized full header-detail SQL aggregation requires a generic extension",
      replaceDetails: "Atomic bounded document collection replacement, CAS and full audit require the ProtocolIA runtime",
      reconcileExact: "Snapshot-based cross-entity exact ledger reconciliation and authorization are not generated by stock JHipster",
      reassignReference: "Audited compare-and-swap FK reassignment is not generated by stock JHipster",
      inboxPage: "Recipient identity scoped inbox is not generated by stock JHipster",
      ackNotification: "Recipient scoped acknowledgement is not generated by stock JHipster",
      auditPage: "Separately authorized audit event paging and identity-filtered journal are not generated by stock JHipster",
      patchFields: "Field-restricted PATCH with exact path and behavior needs a generic extension",
      patchTogether: "Atomic two-column business-key updates and conflict semantics are not generated by stock JDL",
      atomicIncrement: "SQL-atomic addition with overflow protection is not generated by JDL",
      transition: "Atomic, source-guarded business state transitions are not generated by JDL",
      delete: "External-key DELETE, authorization and 204/404 status fidelity are not generated by JDL",
      health: "JHipster actuator health does not prove the /health response contract",
    };
    blockers.push({code:"BEHAVIOR_UNVERIFIED",operation:op.name,detail:detail[op.behavior.kind]});
  }
  return {
    adapter:"jhipster-spring",generatorVersion:"9.4.0",
    canEmitJdl:true,fullContractSupported:blockers.length===0,blockers,
  };
}

export function emitJhipsterApplicationJdl(ir: IrDocument): string {
  // Only infrastructure configuration is selected here; domain is read solely from IR.
  const application = [
    "application {",
    "  config {",
    "    baseName protocoliaTaller",
    "    applicationType monolith",
    "    authenticationType jwt",
    "    packageName dev.protocolia.generated",
    "    clientFramework react",
    "    buildTool maven",
    "    databaseType sql",
    "    devDatabaseType postgresql",
    "    prodDatabaseType postgresql",
    "    cacheProvider no",
    "    enableTranslation false",
    "  }",
    "  entities " + ir.entities.map((e) => identifier(e.name)).join(", "),
    "}",
  ];
  return application.join("\n") + "\n\n" + emitJdl(ir);
}
