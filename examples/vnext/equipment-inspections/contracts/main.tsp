import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Equipment Inspections" })
namespace EquipmentInspections {
  @entity
  @view("Equipos")
  model Equipment {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    code: string;
    @minLength(1) @maxLength(120)
    name: string;
  }

  @entity
  @view("Inspecciones")
  model Inspection {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    number: string;
    @reference("Equipment", "restrict")
    @minLength(1) @maxLength(40)
    equipmentCode: string;
    @minLength(1) @maxLength(160)
    notes: string;
  }

  model EquipmentRequest {
    @minLength(1) @maxLength(40) code: string;
    @minLength(1) @maxLength(120) name: string;
  }
  model InspectionRequest {
    @minLength(1) @maxLength(40) number: string;
    @minLength(1) @maxLength(40) equipmentCode: string;
    @minLength(1) @maxLength(160) notes: string;
  }
  model EquipmentPage {
    items: Equipment[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model InspectionPage {
    items: Inspection[];
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

  @route("/api/equipment")
  @post
  @behavior("create","Equipment")
  @capability("equipment.write")
  op createEquipment(@body input: EquipmentRequest):
     { @statusCode _: 201; @body result: Equipment; }
     | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/equipment/{code}")
  @get
  @behavior("get","Equipment")
  @capability("equipment.read")
  op getEquipment(@path code:string): Equipment | NotFound | Unauthorized | Forbidden;

  @route("/api/equipment")
  @get
  @behavior("listPage","Equipment")
  @capability("equipment.read")
  op listEquipment(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): EquipmentPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/equipment/{code}")
  @delete
  @behavior("delete","Equipment")
  @capability("equipment.write")
  op deleteEquipment(@path code:string): { @statusCode _: 204; }
    | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/inspections")
  @post
  @behavior("create","Inspection")
  @capability("inspections.write")
  op createInspection(@body input: InspectionRequest):
    { @statusCode _: 201; @body result: Inspection; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/inspections/{number}")
  @get
  @behavior("get","Inspection")
  @capability("inspections.read")
  op getInspection(@path number:string): Inspection | NotFound | Unauthorized | Forbidden;

  @route("/api/inspections")
  @get
  @behavior("listPage","Inspection")
  @capability("inspections.read")
  op listInspections(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): InspectionPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/inspections/{number}")
  @delete
  @behavior("delete","Inspection")
  @capability("inspections.write")
  op deleteInspection(@path number:string): { @statusCode _: 204; }
    | NotFound | Unauthorized | Forbidden;

  @route("/health")
  @get
  @behavior("health","Equipment")
  @capability("public")
  op health(): Health;
}
