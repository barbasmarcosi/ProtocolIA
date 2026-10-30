import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

// Independent document-archive business brief: neither Taller nor maintenance.
// No generated backend, SQL or React file may be manually edited for this case.
@service(#{ title: "Community Archive" })
namespace CommunityArchive {
  @entity
  @view("Salas de archivo")
  model ArchiveRoom {
    @publicIdentity @unique @minLength(1) @maxLength(32)
    roomCode: string;
    @minLength(1) @maxLength(100)
    label: string;
  }
  @entity
  @view("Cajas documentales")
  model RecordBox {
    @publicIdentity @unique @minLength(1) @maxLength(32)
    reference: string;
    @reference("ArchiveRoom", "restrict") @minLength(1) @maxLength(32)
    roomCode: string;
    @minLength(1) @maxLength(160)
    description: string;
    @minValue(0)
    pagesDigitized: int32;
    nextReviewAt?: utcDateTime | null;
  }
  model ArchiveRoomRequest {
    @minLength(1) @maxLength(32) roomCode: string;
    @minLength(1) @maxLength(100) label: string;
  }
  model RecordBoxRequest {
    @minLength(1) @maxLength(32) reference: string;
    @minLength(1) @maxLength(32) roomCode: string;
    @minLength(1) @maxLength(160) description: string;
    @minValue(0) pagesDigitized: int32;
    nextReviewAt?: utcDateTime | null;
  }
  model RecordBoxDescriptionChange {
    @minLength(1) @maxLength(160) description: string;
  }
  model DigitizedPages {
    @minValue(1) @maxValue(5) delta: int32;
  }
  model ArchiveRoomPage {
    items: ArchiveRoom[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model RecordBoxPage {
    items: RecordBox[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model Health { status: string; }

  @error model BadRequest { @statusCode _: 400; message: string; }
  @error model Unauthorized { @statusCode _: 401; message: string; }
  @error model Forbidden { @statusCode _: 403; message: string; }
  @error model NotFound { @statusCode _: 404; message: string; }
  @error model Conflict { @statusCode _: 409; message: string; }

  @route("/api/archive-rooms")
  @post @behavior("create", "ArchiveRoom") @capability("archive.write")
  op createArchiveRoom(@body input: ArchiveRoomRequest):
    { @statusCode _: 201; @body item: ArchiveRoom; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/archive-rooms/{roomCode}")
  @get @behavior("get", "ArchiveRoom") @capability("archive.read")
  op getArchiveRoom(@path roomCode: string): ArchiveRoom | NotFound | Unauthorized | Forbidden;

  @route("/api/archive-rooms")
  @get @behavior("listPage", "ArchiveRoom") @capability("archive.read")
  op listArchiveRooms(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): ArchiveRoomPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/archive-rooms/{roomCode}")
  @delete @behavior("delete", "ArchiveRoom") @capability("archive.write")
  op deleteArchiveRoom(@path roomCode: string):
    { @statusCode _: 204; } | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/record-boxes")
  @post @behavior("create", "RecordBox") @capability("archive.write")
  op createRecordBox(@body input: RecordBoxRequest):
    { @statusCode _: 201; @body item: RecordBox; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/record-boxes/{reference}")
  @get @behavior("get", "RecordBox") @capability("archive.read")
  op getRecordBox(@path reference: string): RecordBox | NotFound | Unauthorized | Forbidden;

  @route("/api/record-boxes")
  @get @behavior("listPage", "RecordBox") @capability("archive.read")
  op listRecordBoxes(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): RecordBoxPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/record-boxes/{reference}/description")
  @patch @behavior("patchFields", "RecordBox", "description", "description") @capability("archive.write")
  op updateRecordBoxDescription(@path reference: string, @body input: RecordBoxDescriptionChange):
    RecordBox | NotFound | BadRequest | Unauthorized | Forbidden;

  @route("/api/record-boxes/{reference}/scanned")
  @patch @behavior("atomicIncrement", "RecordBox", "pagesDigitized", "delta") @capability("archive.write")
  op addDigitizedPages(@path reference: string, @body input: DigitizedPages):
    RecordBox | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/record-boxes/{reference}")
  @delete @behavior("delete", "RecordBox") @capability("archive.write")
  op deleteRecordBox(@path reference: string):
    { @statusCode _: 204; } | NotFound | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health", "ArchiveRoom") @capability("public")
  op health(): Health;
}
