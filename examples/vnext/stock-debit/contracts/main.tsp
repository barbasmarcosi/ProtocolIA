import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

// Bounded inventory debit demonstration. No sales, pricing, refunds or SKU normalization.
// StockDebit is the immutable debit journal: a unique debitId prevents accidental replay.
@service(#{ title: "Stock Debit Laboratory" })
namespace StockDebitLab {
  @entity
  @view("Inventory items")
  model StockItem {
    @publicIdentity
    @unique
    @minLength(1)
    @maxLength(40)
    sku: string;

    @minLength(1)
    @maxLength(100)
    name: string;

    @minValue(0)
    @maxValue(100000)
    available: int32;
  }

  @entity
  @view("Stock debit journal")
  model StockDebit {
    @publicIdentity
    @unique
    @minLength(1)
    @maxLength(48)
    debitId: string;

    @reference("StockItem", "restrict")
    @minLength(1)
    @maxLength(40)
    stockSku: string;

    @minValue(1)
    @maxValue(1000)
    units: int32;

    @initial("posted")
    state: string;
  }

  model StockItemRequest {
    @minLength(1) @maxLength(40) sku: string;
    @minLength(1) @maxLength(100) name: string;
    @minValue(0) @maxValue(100000) available: int32;
  }
  model StockDebitRequest {
    @minLength(1) @maxLength(48) debitId: string;
    @minLength(1) @maxLength(40) stockSku: string;
    @minValue(1) @maxValue(1000) units: int32;
  }
  model StockItemPage {
    items: StockItem[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model StockDebitPage {
    items: StockDebit[];
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

  @route("/api/stock-items")
  @post
  @behavior("create", "StockItem")
  @capability("stock.write")
  op createStockItem(@body input: StockItemRequest):
      { @statusCode _: 201; @body item: StockItem; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/stock-items/{sku}")
  @get
  @behavior("get", "StockItem")
  @capability("stock.read")
  op getStockItem(@path sku: string): StockItem | NotFound | Unauthorized | Forbidden;

  @route("/api/stock-items")
  @get
  @behavior("listPage", "StockItem")
  @capability("stock.read")
  op listStockItems(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): StockItemPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/stock-debits")
  @post
  @behavior("create", "StockDebit")
  @reserve("StockItem", "available", "stockSku", "units")
  @capability("stock-debits.write")
  op createStockDebit(@body input: StockDebitRequest):
      { @statusCode _: 201; @body debit: StockDebit; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/stock-debits/{debitId}")
  @get
  @behavior("get", "StockDebit")
  @capability("stock-debits.read")
  op getStockDebit(@path debitId: string):
    StockDebit | NotFound | Unauthorized | Forbidden;

  @route("/api/stock-debits")
  @get
  @behavior("listPage", "StockDebit")
  @capability("stock-debits.read")
  op listStockDebits(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): StockDebitPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/stock-debits/{debitId}/reverse")
  @post
  @behavior("transition", "StockDebit", "state")
  @transition("posted", "reversed")
  @release("StockItem", "available", "stockSku", "units")
  @audit("state")
  @capability("stock-debits.write")
  op reverseStockDebit(@path debitId: string):
    StockDebit | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get
  @behavior("health", "StockItem")
  @capability("public")
  op health(): Health;
}
