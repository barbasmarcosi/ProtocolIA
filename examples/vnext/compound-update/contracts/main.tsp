import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Lotes administrativos — unicidad compuesta" })
namespace BusinessBatches {
  @entity
  @view("Lotes")
  @uniqueTogether("branch,period")
  model Batch {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    code: string;
    @minLength(1) @maxLength(40)
    branch: string;
    @minLength(7) @maxLength(7)
    period: string;
    @minLength(1) @maxLength(160)
    description: string;
  }

  model BatchCreate {
    @minLength(1) @maxLength(40) code: string;
    @minLength(1) @maxLength(40) branch: string;
    @minLength(7) @maxLength(7) period: string;
    @minLength(1) @maxLength(160) description: string;
  }
  model BatchKeyChange {
    @minLength(1) @maxLength(40) branch: string;
    @minLength(7) @maxLength(7) period: string;
  }
  model BatchPage {
    items: Batch[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model Health { status: string; }

  @error model NotFound { @statusCode _: 404; message: string; }
  @error model Conflict { @statusCode _: 409; message: string; }
  @error model BadRequest { @statusCode _: 400; message: string; }
  @error model Unauthorized { @statusCode _: 401; message: string; }
  @error model Forbidden { @statusCode _: 403; message: string; }

  @route("/api/batches")
  @post @behavior("create","Batch") @capability("batches.write")
  op createBatch(@body input: BatchCreate):
    { @statusCode _: 201; @body result: Batch; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/batches/{code}")
  @get @behavior("get","Batch") @capability("batches.read")
  op getBatch(@path code: string):
    Batch | NotFound | Unauthorized | Forbidden;

  @route("/api/batches")
  @get @behavior("listPage","Batch") @capability("batches.read")
  op listBatch(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): BatchPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/batches/{code}/key")
  @patch @behavior("patchTogether","Batch")
  @patchTogether("branch,period") @capability("batches.write")
  op changeBusinessKey(@path code: string,@body input: BatchKeyChange):
    Batch | BadRequest | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/batches/{code}")
  @delete @behavior("delete","Batch") @capability("batches.write")
  op deleteBatch(@path code: string):
    { @statusCode _: 204; } | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health","Batch") @capability("public")
  op health(): Health;
}
