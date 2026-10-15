import "../dist/index.js";
using TypeSpec.Reflection;
namespace ProtocolIA.Domain {
  extern dec recipientIdentity(target: Model);
  extern dec entity(target: Model);
  extern dec publicIdentity(target: ModelProperty);
  extern dec unique(target: ModelProperty);
  extern dec reference(target: ModelProperty, entity: valueof string, onDelete?: valueof string);
  extern dec view(target: Model, label: valueof string);
  extern dec initial(target: ModelProperty, value: valueof string);
  extern dec computedSum(target: ModelProperty, fields: valueof string);
  extern dec transition(target: Operation, from: valueof string, to: valueof string);
  extern dec reserve(target: Operation, stockEntity: valueof string,
    availableField: valueof string, referenceField: valueof string, quantityField: valueof string);
  extern dec release(target: Operation, stockEntity: valueof string,
    availableField: valueof string, referenceField: valueof string, quantityField: valueof string);
  extern dec audit(target: Operation, fields: valueof string);
  extern dec behavior(target: Operation, kind: valueof string,
    entity: valueof string, field?: valueof string, input?: valueof string);
  extern dec queryFilter(target: ModelProperty, path: valueof string, operator: valueof string);
  extern dec queryOrder(target: Operation, field: valueof string, direction: valueof string);
  extern dec overdueAlert(target: Model, dueField: valueof string, stateField: valueof string,
    terminalState: valueof string, recipientField: valueof string, channel: valueof string);
  extern dec capability(target: Operation, name: valueof string);
}
