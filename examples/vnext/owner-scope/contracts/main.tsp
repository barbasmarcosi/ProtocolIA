import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Private Notes Authorization" })
namespace PrivateNotes {
  @entity @view("Mis notas")
  model PrivateNote {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    noteCode: string;
    @ownerIdentity @minLength(1) @maxLength(128)
    owner: string;
    @uiLabel("Título") @minLength(1) @maxLength(90)
    title: string;
  }
  model PrivateNoteInput {
    @minLength(1) @maxLength(40) noteCode: string;
    @minLength(1) @maxLength(90) title: string;
  }
  model NoteTitleUpdate {
    @minLength(1) @maxLength(90) title: string;
  }
  model NotePage {
    items: PrivateNote[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model Health { status: string; }
  @error model BadRequest { @statusCode _: 400; message: string; }
  @error model Conflict { @statusCode _: 409; message: string; }
  @error model NotFound { @statusCode _: 404; message: string; }
  @error model Unauthorized { @statusCode _: 401; message: string; }
  @error model Forbidden { @statusCode _: 403; message: string; }

  @route("/api/notes") @post @behavior("create","PrivateNote") @capability("notes.write")
  op createNote(@body input: PrivateNoteInput):
    { @statusCode _: 201; @body note: PrivateNote; } | BadRequest | Conflict | Unauthorized | Forbidden;
  @route("/api/notes/{noteCode}") @get @behavior("get","PrivateNote") @capability("notes.read")
  op getNote(@path noteCode: string): PrivateNote | NotFound | Unauthorized | Forbidden;
  @route("/api/notes") @get @behavior("listPage","PrivateNote") @capability("notes.read")
  op listNotes(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0):
    NotePage | BadRequest | Unauthorized | Forbidden;
  @route("/api/notes/{noteCode}/title") @patch
  @behavior("patchFields","PrivateNote","title","title") @capability("notes.title.write")
  op updateNoteTitle(@path noteCode: string, @body input: NoteTitleUpdate):
    PrivateNote | BadRequest | NotFound | Unauthorized | Forbidden;
  @route("/health") @get @behavior("health","PrivateNote") @capability("public")
  op health(): Health;
}
