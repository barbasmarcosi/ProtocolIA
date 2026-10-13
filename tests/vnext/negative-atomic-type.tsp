import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;
namespace NegativeAtomicType {
  @entity model Widget {
    @publicIdentity @unique code: string;
    value: string;
  }
  model Increase { @minValue(1) amount: int32; }
  @patch @route("/api/widgets/{code}/quantity")
  @behavior("atomicIncrement","Widget","value","amount")
  @capability("widget.write")
  op increase(@path code: string,@body input: Increase): Widget;
}
