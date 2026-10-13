import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Taller Inventory" })
namespace TallerInventory {
  @entity
  @view("Inventario de herramientas")
  model Tool {
    @publicIdentity
    @unique
    @minLength(1)
    @maxLength(64)
    code: string;

    @minLength(1)
    @maxLength(255)
    name: string;

    @minValue(0)
    quantity: int32;

    // Omitted and explicit null remain different in request semantics.
    lastReviewedAt?: utcDateTime | null;
  }

  model ToolRequest {
    @minLength(1)
    @maxLength(64)
    code: string;
    @minLength(1)
    @maxLength(255)
    name: string;
    @minValue(0)
    quantity: int32;
    lastReviewedAt?: utcDateTime | null;
  }

  model QuantityAdjustment {
    @minValue(1)
    @maxValue(1000)
    amount: int32;
  }
  model ToolNameChange {
    @minLength(1)
    @maxLength(255)
    name: string;
  }
  model ToolPage {
    items: Tool[];
    @minValue(1)
    @maxValue(50)
    limit: int32;
    @minValue(0)
    offset: int32;
    @minValue(0)
    total: int32;
  }
  model Health { status: string; }

  @error model NotFound {
    @statusCode _: 404;
    message: string;
  }
  @error model Conflict {
    @statusCode _: 409;
    message: string;
  }
  @error model BadRequest {
    @statusCode _: 400;
    message: string;
  }
  @error model Unauthorized {
    @statusCode _: 401;
    message: string;
  }
  @error model Forbidden {
    @statusCode _: 403;
    message: string;
  }

  @route("/api/tools")
  @post
  @behavior("create", "Tool")
  @capability("inventory.write")
  op createTool(@body input: ToolRequest):
      { @statusCode _: 201; @body tool: Tool; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/tools/{code}")
  @get
  @behavior("get", "Tool")
  @capability("inventory.read")
  op getTool(@path code: string): Tool | NotFound | Unauthorized | Forbidden;

  @route("/api/tools")
  @get
  @behavior("listPage", "Tool")
  @capability("inventory.read")
  op listTools(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): ToolPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/tools/{code}/quantity")
  @patch
  @behavior("atomicIncrement", "Tool", "quantity", "amount")
  @capability("inventory.write")
  op increaseQuantity(@path code: string, @body input: QuantityAdjustment):
      Tool | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/tools/{code}/name")
  @patch
  @behavior("patchFields", "Tool", "name", "name")
  @capability("inventory.write")
  op renameTool(@path code: string, @body input: ToolNameChange):
      Tool | NotFound | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get
  @behavior("health", "Tool")
  @capability("public")
  op health(): Health;
}
