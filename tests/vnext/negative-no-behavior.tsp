import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;
namespace NegativeNoBehavior {
  @entity model Widget {
    @publicIdentity @unique code: string;
    value: int32;
  }
  @get @route("/api/widgets")
  @capability("widget.read")
  op list(): Widget[];
}
