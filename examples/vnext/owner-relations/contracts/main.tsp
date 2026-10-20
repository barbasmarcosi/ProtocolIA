import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Owner-Scoped Relationships" })
namespace OwnerRelations {
  @entity @view("Carpetas privadas")
  model Folder {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    folderCode: string;
    @ownerIdentity @minLength(1) @maxLength(128)
    owner: string;
    @minLength(1) @maxLength(80) title: string;
  }
  model FolderInput {
    @minLength(1) @maxLength(40) folderCode: string;
    @minLength(1) @maxLength(80) title: string;
  }
  model FolderPage {
    items: Folder[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity @view("Notas de carpetas")
  model FolderNote {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    noteCode: string;
    @ownerIdentity @minLength(1) @maxLength(128)
    owner: string;
    @reference("Folder","restrict") @minLength(1) @maxLength(40)
    folderCode: string;
    @minLength(1) @maxLength(80) title: string;
  }
  model FolderNoteInput {
    @minLength(1) @maxLength(40) noteCode: string;
    @minLength(1) @maxLength(40) folderCode: string;
    @minLength(1) @maxLength(80) title: string;
  }
  model FolderNotePage {
    items: FolderNote[];
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

  @route("/api/folders") @post @behavior("create","Folder") @capability("folders.write")
  op createFolder(@body input: FolderInput):
    { @statusCode _: 201; @body folder: Folder; } | BadRequest | Conflict | Unauthorized | Forbidden;
  @route("/api/folders/{folderCode}") @get @behavior("get","Folder") @capability("folders.read")
  op getFolder(@path folderCode: string): Folder | NotFound | Unauthorized | Forbidden;
  @route("/api/folders") @get @behavior("listPage","Folder") @capability("folders.read")
  op listFolders(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0):
    FolderPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/folder-notes") @post @behavior("create","FolderNote") @capability("folderNotes.write")
  op createFolderNote(@body input: FolderNoteInput):
    { @statusCode _: 201; @body note: FolderNote; } | BadRequest | Conflict | Unauthorized | Forbidden;
  @route("/api/folder-notes/{noteCode}") @get @behavior("get","FolderNote") @capability("folderNotes.read")
  op getFolderNote(@path noteCode: string): FolderNote | NotFound | Unauthorized | Forbidden;
  @route("/api/folder-notes") @get @behavior("listPage","FolderNote") @capability("folderNotes.read")
  op listFolderNotes(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0):
    FolderNotePage | BadRequest | Unauthorized | Forbidden;
  @route("/health") @get @behavior("health","Folder") @capability("public")
  op health(): Health;
}
