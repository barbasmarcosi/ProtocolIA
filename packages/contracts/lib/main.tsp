import "../dist/index.js";
using TypeSpec.Reflection;
namespace ProtocolIA.Domain {
  extern dec recipientIdentity(target: Model);
  extern dec entity(target: Model);
  extern dec publicIdentity(target: ModelProperty);
  extern dec unique(target: ModelProperty);
  extern dec reference(target: ModelProperty, entity: valueof string, onDelete?: valueof string);
  extern dec view(target: Model, label: valueof string);
  // Presentation metadata only: never changes business validation or authorization.
  extern dec uiLabel(target: ModelProperty, label: valueof string);
  extern dec uiHelp(target: ModelProperty, help: valueof string);
  extern dec uiControl(target: ModelProperty, control: valueof string);
  extern dec uiSection(target: ModelProperty, section: valueof string);
  extern dec uiPlaceholder(target: ModelProperty, placeholder: valueof string);
  extern dec initial(target: ModelProperty, value: valueof string);
  extern dec computedSum(target: ModelProperty, fields: valueof string);
  // Read-only base-10 multiplication, materialized exactly in PostgreSQL.
  extern dec computedProduct(target: ModelProperty, left: valueof string, right: valueof string);
  // Output scale is @exactDecimal(...). PostgreSQL half-up is defined for nonnegative products.
  extern dec computedRoundedProduct(target: ModelProperty, left: valueof string,
    right: valueof string, mode: valueof string);
  // Compound SQL expression over editable sources; not generated-column chaining.
  extern dec computedDiscountedTotal(target: ModelProperty, price: valueof string,
    quantity: valueof string, discount: valueof string, mode: valueof string);
  // A string field is mandatory when an enum-valued sibling equals a declared value.
  extern dec requiredWhen(target: ModelProperty, field: valueof string, equals: valueof string);
  // Strict temporal order against another UTC date-time in the same entity.
  extern dec afterField(target: ModelProperty, field: valueof string);
  // Strict exact decimal or int32 comparison against a required sibling of the same scalar family.
  extern dec greaterThanField(target: ModelProperty, field: valueof string);
  // Exact decimal, encoded as JSON string; bounds are strings to avoid JS rounding.
  extern dec exactDecimal(target: ModelProperty, precision: valueof int32, scale: valueof int32,
    min?: valueof string, max?: valueof string);
  extern dec transition(target: Operation, from: valueof string, to: valueof string);
  extern dec reserve(target: Operation, stockEntity: valueof string,
    availableField: valueof string, referenceField: valueof string, quantityField: valueof string);
  extern dec release(target: Operation, stockEntity: valueof string,
    availableField: valueof string, referenceField: valueof string, quantityField: valueof string);
  // Single-statement SUM over active child rows; requires both parent/child read authority.
  extern dec relatedSum(target: Operation, childEntity: valueof string, referenceField: valueof string,
    quantityField: valueof string, stateField: valueof string, activeState: valueof string);
  extern dec audit(target: Operation, fields: valueof string);
  extern dec behavior(target: Operation, kind: valueof string,
    entity: valueof string, field?: valueof string, input?: valueof string);
  extern dec queryFilter(target: ModelProperty, path: valueof string, operator: valueof string);
  extern dec queryOrder(target: Operation, field: valueof string, direction: valueof string);
  extern dec overdueAlert(target: Model, dueField: valueof string, stateField: valueof string,
    terminalState: valueof string, recipientField: valueof string, channel: valueof string);
  extern dec capability(target: Operation, name: valueof string);
}
