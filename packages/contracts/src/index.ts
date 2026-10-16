import { createTypeSpecLibrary, type Program, type Type, type DecoratorContext, type Model,
  type ModelProperty, type Operation } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name:"@protocolia/domain",
  diagnostics:{},
  state:{
    entity: {description:"ProtocolIA entity contract metadata"},
    publicIdentity: {description:"ProtocolIA publicIdentity contract metadata"},
    unique: {description:"ProtocolIA unique contract metadata"},
    reference: {description:"ProtocolIA foreign-key reference to a public identity"},
    view: {description:"ProtocolIA view contract metadata"},
    uiLabel: {description:"User-visible human label on a field, independent of persistence name"},
    uiHelp: {description:"Contextual user guidance on a field"},
    uiControl: {description:"Display-only input control hint, no business semantic change"},
    uiSection: {description:"Declarative visual grouping for editable form fields"},
    uiPlaceholder: {description:"Presentation-only sample text, not a default or constraint"},
    initial: {description:"Initial immutable state for a finite-state field"},
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

function transition(context: DecoratorContext, target: Operation, from: string, to: string): void {
  context.program.stateMap($lib.stateKeys.transition).set(target, {from, to});
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
    unique,
    reference,
    view,
    uiLabel,
    uiHelp,
    uiControl,
    uiSection,
    uiPlaceholder,
    initial,
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
