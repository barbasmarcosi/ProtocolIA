import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;
namespace NegativePublicWrite {
  @entity model Widget { @publicIdentity @unique code: string; }
  model Input { code: string; }
  @post @route("/api/widgets")
  @behavior("create","Widget")
  @capability("public")
  op create(@body input: Input): {@statusCode _: 201; @body widget: Widget;};
}
