import { createTypeSpecLibrary, type Program, type Type, type DecoratorContext, type Model,
  type ModelProperty, type Operation } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name:"@protocolia/domain",
  diagnostics:{},
  state:{
    entity: {description:"ProtocolIA entity contract metadata"},
    publicIdentity: {description:"ProtocolIA publicIdentity contract metadata"},
    unique: {description:"ProtocolIA unique contract metadata"},
    uniqueTogether: {description:"Required fields unique as a compound business key"},
    patchTogether: {description:"Atomic 2–4-field business-key update on a declared uniqueTogether entity"},
    uniqueWhen: {description:"Partial unique business key limited to one declared finite state"},
    ownerIdentity: {description:"Non-client-writable owner field bound to authenticated subject"},
    readCapability: {description:"Omit an optional sensitive response field without its independent read permission"},
    reference: {description:"ProtocolIA foreign-key reference to a public identity"},
    view: {description:"ProtocolIA view contract metadata"},
    uiLabel: {description:"User-visible human label on a field, independent of persistence name"},
    uiHelp: {description:"Contextual user guidance on a field"},
    uiControl: {description:"Display-only input control hint, no business semantic change"},
    uiSection: {description:"Declarative visual grouping for editable form fields"},
    uiPlaceholder: {description:"Presentation-only sample text, not a default or constraint"},
    initial: {description:"Initial immutable state for a finite-state field"},
    fixedInitial: {description:"Server-only immutable fixed string with database constraint"},
    computedSum: {description:"Read-only bounded sum of required integer fields"},
    computedProduct: {description:"Read-only exact decimal product of two required nonnegative fields"},
    computedRoundedProduct: {description:"Read-only rounded positive decimal product, explicit half_up mode"},
    computedDiscountedTotal: {description:"Read-only discounted monetary total, typed half_up rounding"},
    requiredWhen: {description:"Require an optional field when a sibling enum matches its source-declared value"},
    forbidWhen: {description:"Forbid an optional field when a sibling enum matches a declared value"},
    afterField: {description:"A UTC date-time must be strictly after a required sibling UTC date-time"},
    greaterThanField: {description:"Strict comparison between typed int32 fields or exact decimal fields"},
    exactDecimal: {description:"Exact base10 precision, scale and string-encoded minimum/maximum bounds"},
    transition: {description:"Atomic business state transition with guarded source/target"},
    reserve: {description:"Atomic checked stock debit and referenced reservation insert"},
    moveUnits: {description:"Atomic two-record inventory transfer and durable movement creation"},
    moveBatch: {description:"Atomic 2–4-leg movement net settlement over shared parent balances and durable journal row"},
    createDetails: {description:"Atomic parent and dynamic typed child collection insert (1–20 rows)"},
    versionedDetails: {description:"Opt-in document-wide optimistic version for bounded detail append and audited child patches"},
    replaceDetails: {description:"Atomically replace all child rows of a versioned bounded document"},
    detailSum: {description:"Authorized, snapshot-consistent full relational detail quantity sum"},
    reverseBatch: {description:"Exactly-once reversal of all bounded batch legs in one auditable transaction"},
    reverseUnits: {description:"Exactly-once guarded reversal of a journalled transfer"},
    debitExact: {description:"Atomic exact decimal debit and durable child posting"},
    reverseExact: {description:"Exactly-once guarded reversal and exact decimal credit"},
    reconcileExact: {description:"Authorized snapshot reconciliation with optional typed charge-source initialization guard"},
    release: {description:"Exactly-once guarded cancellation and transactional stock restoration"},
    relatedSum: {description:"Read-only MVCC snapshot of active quantities in a related entity"},
    audit: {description:"Auditable, explicitly allowlisted business fields; no request payload logging"},
    behavior: {description:"ProtocolIA behavior contract metadata"},
    capability: {description:"ProtocolIA capability contract metadata"},
    queryFilter: {description:"Explicit typed HTTP query filter on an entity or one FK hop"},
    queryOrder: {description:"Deterministic declared query ordering"},
    recipientIdentity: {description:"Explicit trusted issuer/subject to recipient binding"},
    overdueAlert: {description:"Persistent overdue inbox rule; no external delivery implied"},
  },
});

function entity(context: DecoratorContext, target: Model): void {
  context.program.stateMap($lib.stateKeys.entity).set(target, {});
}

function publicIdentity(context: DecoratorContext, target: ModelProperty): void {
  context.program.stateMap($lib.stateKeys.publicIdentity).set(target, {});
}

function unique(context: DecoratorContext, target: ModelProperty): void {
  context.program.stateMap($lib.stateKeys.unique).set(target, {});
}

function uniqueWhen(context: DecoratorContext, target: Model,
  fields: string, stateField: string, activeState: string): void {
  context.program.stateMap($lib.stateKeys.uniqueWhen).set(target,{fields,stateField,activeState});
}
function patchTogether(context: DecoratorContext, target: Operation, fields: string): void {
  context.program.stateMap($lib.stateKeys.patchTogether).set(target,{fields});
}

function uniqueTogether(context: DecoratorContext, target: Model, fields: string): void {
  context.program.stateMap($lib.stateKeys.uniqueTogether).set(target,{fields});
}

function reference(context: DecoratorContext, target: ModelProperty, entity: string, onDelete?: string): void {
  context.program.stateMap($lib.stateKeys.reference).set(target, {entity, onDelete: onDelete ?? "restrict"});
}

function view(context: DecoratorContext, target: Model, label: string): void {
  context.program.stateMap($lib.stateKeys.view).set(target, { label });
}

function uiLabel(context: DecoratorContext, target: ModelProperty, label: string): void {
  context.program.stateMap($lib.stateKeys.uiLabel).set(target,{label});
}
function uiHelp(context: DecoratorContext, target: ModelProperty, help: string): void {
  context.program.stateMap($lib.stateKeys.uiHelp).set(target,{help});
}
function uiControl(context: DecoratorContext, target: ModelProperty, control: string): void {
  context.program.stateMap($lib.stateKeys.uiControl).set(target,{control});
}
function uiSection(context: DecoratorContext, target: ModelProperty, section: string): void {
  context.program.stateMap($lib.stateKeys.uiSection).set(target,{section});
}
function uiPlaceholder(context: DecoratorContext, target: ModelProperty, placeholder: string): void {
  context.program.stateMap($lib.stateKeys.uiPlaceholder).set(target,{placeholder});
}

function initial(context: DecoratorContext, target: ModelProperty, value: string): void {
  context.program.stateMap($lib.stateKeys.initial).set(target, {value});
}

function fixedInitial(context: DecoratorContext, target: ModelProperty, value: string): void {
  context.program.stateMap($lib.stateKeys.fixedInitial).set(target,{value});
}

function computedSum(context: DecoratorContext, target: ModelProperty, fields: string): void {
  context.program.stateMap($lib.stateKeys.computedSum).set(target,{fields});
}

function computedProduct(context: DecoratorContext, target: ModelProperty, left: string, right: string): void {
  context.program.stateMap($lib.stateKeys.computedProduct).set(target,{left,right});
}
function computedRoundedProduct(context: DecoratorContext, target: ModelProperty, left: string, right: string, mode: string): void {
  context.program.stateMap($lib.stateKeys.computedRoundedProduct).set(target,{left,right,mode});
}
function computedDiscountedTotal(context: DecoratorContext, target: ModelProperty,
    price: string, quantity: string, discount: string, mode: string): void {
  context.program.stateMap($lib.stateKeys.computedDiscountedTotal).set(target,{price,quantity,discount,mode});
}
function exactDecimal(context: DecoratorContext, target: ModelProperty, precision: number, scale: number, min?: string, max?: string): void {
  context.program.stateMap($lib.stateKeys.exactDecimal).set(target,{precision,scale,min,max});
}

function afterField(context: DecoratorContext, target: ModelProperty, field: string): void {
  context.program.stateMap($lib.stateKeys.afterField).set(target,{field});
}
function greaterThanField(context: DecoratorContext, target: ModelProperty, field: string): void {
  context.program.stateMap($lib.stateKeys.greaterThanField).set(target,{field});
}

function requiredWhen(context: DecoratorContext, target: ModelProperty, field: string, equals: string): void {
  context.program.stateMap($lib.stateKeys.requiredWhen).set(target,{field,equals});
}
function forbidWhen(context: DecoratorContext, target: ModelProperty, field: string, equals: string): void {
  context.program.stateMap($lib.stateKeys.forbidWhen).set(target,{field,equals});
}

function readCapability(context: DecoratorContext, target: ModelProperty, capability: string): void {
  context.program.stateMap($lib.stateKeys.readCapability).set(target,{capability});
}
function ownerIdentity(context: DecoratorContext, target: ModelProperty): void {
  context.program.stateMap($lib.stateKeys.ownerIdentity).set(target,{enabled:true});
}
function transition(context: DecoratorContext, target: Operation, from: string, to: string): void {
  context.program.stateMap($lib.stateKeys.transition).set(target, {from, to});
}

function reconcileExact(context: DecoratorContext, target: Operation, openingField: string,
  availableField: string, childEntity: string, referenceField: string, amountField: string,
  stateField: string, postedState: string, reversedState: string, chargeSource?: string,
  serverOnly?: boolean, lifecycle?: boolean, adjustmentPreview?: boolean,
  adjustmentJournal?: boolean, unverifiedProofField?: string): void {
  context.program.stateMap($lib.stateKeys.reconcileExact).set(target,
    {openingField,availableField,childEntity,referenceField,amountField,stateField,postedState,reversedState,
     ...(chargeSource!==undefined?{chargeSource}:{}),
     ...(serverOnly!==undefined?{serverOnly}:{}),
     ...(lifecycle!==undefined?{lifecycle}:{}),
     ...(adjustmentPreview!==undefined?{adjustmentPreview}:{}),
     ...(adjustmentJournal!==undefined?{adjustmentJournal}:{}),
     ...(unverifiedProofField!==undefined?{unverifiedProofField}:{})});
}
function reverseExact(context: DecoratorContext, target: Operation, balanceEntity: string,
  availableField: string, referenceField: string, amountField: string): void {
  context.program.stateMap($lib.stateKeys.reverseExact).set(target,
    {stockEntity:balanceEntity,availableField,referenceField,quantityField:amountField});
}
function debitExact(context: DecoratorContext, target: Operation, balanceEntity: string,
  availableField: string, referenceField: string, amountField: string): void {
  context.program.stateMap($lib.stateKeys.debitExact).set(target,
    {stockEntity:balanceEntity,availableField,referenceField,quantityField:amountField});
}
function reverseBatch(context: DecoratorContext, target: Operation, stockEntity: string,
    availableField: string, legs: string): void {
  context.program.stateMap($lib.stateKeys.reverseBatch).set(target,{stockEntity,availableField,legs});
}
function detailSum(context: DecoratorContext, target: Operation, childEntity: string,
    parentField: string, quantityField: string): void {
  context.program.stateMap($lib.stateKeys.detailSum).set(target,
    {childEntity,parentField,quantityField});
}
function createDetails(context: DecoratorContext, target: Operation, childEntity: string,
    parentField: string, rowsField: string, chargeAmountField?: string,
    chargeTotalField?: string): void {
  context.program.stateMap($lib.stateKeys.createDetails).set(target,
    {childEntity,parentField,rowsField,
      ...(chargeAmountField===undefined?{}:{chargeAmountField}),
      ...(chargeTotalField===undefined?{}:{chargeTotalField})});
}
function versionedDetails(context: DecoratorContext, target: Operation,
  closeField?: string, closeState?: string): void {
  // TypeSpec may provide optional decorator arguments as typed string literals.
  // Preserve their declared values rather than object-coercing to "[object Object]".
  const stringArg=(arg:unknown)=>typeof arg==="string"?arg:
    arg&&typeof arg==="object"&&"value" in arg&&typeof arg.value==="string"?
      arg.value:undefined;
  context.program.stateMap($lib.stateKeys.versionedDetails).set(target,
    {enabled:true,...(closeField===undefined?{}:{closeField:stringArg(closeField)}),
      ...(closeState===undefined?{}:{closeState:stringArg(closeState)})});
}
function replaceDetails(context: DecoratorContext, target: Operation): void {
  context.program.stateMap($lib.stateKeys.replaceDetails).set(target,{enabled:true});
}
function moveBatch(context: DecoratorContext, target: Operation, stockEntity: string,
    availableField: string, legs: string): void {
  context.program.stateMap($lib.stateKeys.moveBatch).set(target,
    {stockEntity,availableField,legs});
}
function moveUnits(context: DecoratorContext, target: Operation, stockEntity: string,
    availableField: string, sourceField: string, targetField: string, quantityField: string): void {
  context.program.stateMap($lib.stateKeys.moveUnits).set(target,
    {stockEntity,availableField,sourceField,targetField,quantityField});
}
function reverseUnits(context: DecoratorContext, target: Operation, stockEntity: string,
    availableField: string, sourceField: string, targetField: string, quantityField: string): void {
  context.program.stateMap($lib.stateKeys.reverseUnits).set(target,
    {stockEntity,availableField,sourceField,targetField,quantityField});
}
function reserve(context: DecoratorContext, target: Operation, stockEntity: string,
    availableField: string, referenceField: string, quantityField: string): void {
  context.program.stateMap($lib.stateKeys.reserve).set(target,
    {stockEntity,availableField,referenceField,quantityField});
}

function release(context: DecoratorContext, target: Operation, stockEntity: string,
    availableField: string, referenceField: string, quantityField: string): void {
  context.program.stateMap($lib.stateKeys.release).set(target,
    {stockEntity,availableField,referenceField,quantityField});
}

function relatedSum(context: DecoratorContext, target: Operation, childEntity: string,
    referenceField: string, quantityField: string, stateField: string, activeState: string): void {
  context.program.stateMap($lib.stateKeys.relatedSum).set(target,
    {childEntity,referenceField,quantityField,stateField,activeState});
}
function audit(context: DecoratorContext, target: Operation, fields: string): void {
  context.program.stateMap($lib.stateKeys.audit).set(target, {fields});
}

function behavior(context: DecoratorContext, target: Operation, kind: string, entity: string, field?: string, input?: string): void {
  context.program.stateMap($lib.stateKeys.behavior).set(target, { kind, entity, field, input });
}

function capability(context: DecoratorContext, target: Operation, name: string): void {
  context.program.stateMap($lib.stateKeys.capability).set(target, { name });
}

function queryFilter(context: DecoratorContext, target: ModelProperty, path: string, operator: string): void {
  context.program.stateMap($lib.stateKeys.queryFilter).set(target,{path,operator});
}
function queryOrder(context: DecoratorContext, target: Operation, field: string, direction: string): void {
  context.program.stateMap($lib.stateKeys.queryOrder).set(target,{field,direction});
}

function recipientIdentity(context: DecoratorContext, target: Model): void {
  context.program.stateMap($lib.stateKeys.recipientIdentity).set(target, {});
}

function overdueAlert(context: DecoratorContext, target: Model, dueField: string,
  stateField: string, terminalState: string, recipientField: string, channel: string): void {
  context.program.stateMap($lib.stateKeys.overdueAlert).set(target,
    {dueField,stateField,terminalState,recipientField,channel});
}

export const $decorators = {
  "ProtocolIA.Domain": {
    entity,
    publicIdentity,
    ownerIdentity,
    readCapability,
    unique,
    uniqueTogether,
    patchTogether,
    uniqueWhen,
    reference,
    view,
    uiLabel,
    uiHelp,
    uiControl,
    uiSection,
    uiPlaceholder,
    initial,
    fixedInitial,
    computedSum,
    computedProduct,
    computedRoundedProduct,
    computedDiscountedTotal,
    requiredWhen,
    forbidWhen,
    afterField,
    greaterThanField,
    exactDecimal,
    transition,
    reserve,
    moveUnits,
    moveBatch,
    createDetails,
    versionedDetails,
    replaceDetails,
    detailSum,
    reverseBatch,
    reverseUnits,
    debitExact,
    reverseExact,
    reconcileExact,
    release,
    relatedSum,
    audit,
    behavior,
    capability,
    queryFilter,
    queryOrder,
    overdueAlert,
    recipientIdentity,
  },
};

export function readDomainDecorator(program: Program, name: string, target: Type): Record<string, unknown> | undefined {
  const key = $lib.stateKeys[name as keyof typeof $lib.stateKeys];
  if (!key) throw new Error("Unknown ProtocolIA decorator: " + name);
  return program.stateMap(key).get(target) as Record<string, unknown> | undefined;
}
