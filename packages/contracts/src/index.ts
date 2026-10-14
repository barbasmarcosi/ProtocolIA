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
    initial: {description:"Initial immutable state for a finite-state field"},
    transition: {description:"Atomic business state transition with guarded source/target"},
    reserve: {description:"Atomic checked stock debit and referenced reservation insert"},
    behavior: {description:"ProtocolIA behavior contract metadata"},
    capability: {description:"ProtocolIA capability contract metadata"},
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

function initial(context: DecoratorContext, target: ModelProperty, value: string): void {
  context.program.stateMap($lib.stateKeys.initial).set(target, {value});
}

function transition(context: DecoratorContext, target: Operation, from: string, to: string): void {
  context.program.stateMap($lib.stateKeys.transition).set(target, {from, to});
}

function reserve(context: DecoratorContext, target: Operation, stockEntity: string,
    availableField: string, referenceField: string, quantityField: string): void {
  context.program.stateMap($lib.stateKeys.reserve).set(target,
    {stockEntity,availableField,referenceField,quantityField});
}

function behavior(context: DecoratorContext, target: Operation, kind: string, entity: string, field?: string, input?: string): void {
  context.program.stateMap($lib.stateKeys.behavior).set(target, { kind, entity, field, input });
}

function capability(context: DecoratorContext, target: Operation, name: string): void {
  context.program.stateMap($lib.stateKeys.capability).set(target, { name });
}

export const $decorators = {
  "ProtocolIA.Domain": {
    entity,
    publicIdentity,
    unique,
    reference,
    view,
    initial,
    transition,
    reserve,
    behavior,
    capability,
  },
};

export function readDomainDecorator(program: Program, name: string, target: Type): Record<string, unknown> | undefined {
  const key = $lib.stateKeys[name as keyof typeof $lib.stateKeys];
  if (!key) throw new Error("Unknown ProtocolIA decorator: " + name);
  return program.stateMap(key).get(target) as Record<string, unknown> | undefined;
}
