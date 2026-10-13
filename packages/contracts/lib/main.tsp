// ProtocolIA domain metadata only. Types and HTTP binding remain native TypeSpec.
// Auto decorators require TypeSpec >= 1.14 and are read by @protocolia/compiler.
using TypeSpec.Reflection;
namespace ProtocolIA.Domain {
  auto dec entity(target: Model);
  auto dec publicIdentity(target: ModelProperty);
  auto dec unique(target: ModelProperty);
  auto dec view(target: Model, label: valueof string);
  // Behavior operands are resolved against entity/model fields by the semantic compiler.
  auto dec behavior(
    target: Operation,
    kind: valueof string,
    entity: valueof string,
    field?: valueof string,
    input?: valueof string
  );
  auto dec capability(target: Operation, name: valueof string);
}
