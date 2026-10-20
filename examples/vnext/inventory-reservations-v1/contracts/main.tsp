import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Inventory and Reservations" })
namespace InventoryReservations {
  @entity
  @view("Partes disponibles")
  model Part {
    @publicIdentity @unique @minLength(1) @maxLength(40) sku: string;
    @minLength(1) @maxLength(100) name: string;
    @minValue(0) available: int32;
  }
  @entity
  @view("Reservas")
  model Allocation {
    @publicIdentity @unique @minLength(1) @maxLength(40) number: string;
    @reference("Part", "restrict")
    @minLength(1) @maxLength(40) partSku: string;
    @minValue(1) @maxValue(1000) units: int32;
  }

  model PartRequest {
    @minLength(1) @maxLength(40) sku: string;
    @minLength(1) @maxLength(100) name: string;
    @minValue(0) available: int32;
  }
  model AllocationRequest {
    @minLength(1) @maxLength(40) number: string;
    @minLength(1) @maxLength(40) partSku: string;
    @minValue(1) @maxValue(1000) units: int32;
  }
  model PartPage {
    items: Part[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model AllocationPage {
    items: Allocation[];
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

  @route("/api/parts")
  @post @behavior("create", "Part") @capability("parts.write")
  op createPart(@body input: PartRequest):
    { @statusCode _: 201; @body part: Part; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/parts/{sku}")
  @get @behavior("get", "Part") @capability("parts.read")
  op getPart(@path sku: string): Part | NotFound | Unauthorized | Forbidden;

  @route("/api/parts")
  @get @behavior("listPage", "Part") @capability("parts.read")
  op listParts(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): PartPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/allocations")
  @post @behavior("create", "Allocation")
  @reserve("Part", "available", "partSku", "units")
  @capability("allocations.write")
  op createAllocation(@body input: AllocationRequest):
    { @statusCode _: 201; @body allocation: Allocation; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/allocations/{number}")
  @get @behavior("get", "Allocation") @capability("allocations.read")
  op getAllocation(@path number: string): Allocation | NotFound | Unauthorized | Forbidden;

  @route("/api/allocations")
  @get @behavior("listPage", "Allocation") @capability("allocations.read")
  op listAllocations(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): AllocationPage | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health", "Part") @capability("public")
  op health(): Health;
}
