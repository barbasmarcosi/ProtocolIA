import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{title:"B12 dynamic purchase orders"})
namespace DynamicOrders {
  @entity @view("Órdenes")
  model PurchaseOrder {
    @publicIdentity @unique @minLength(1) @maxLength(40) code:string;
    @minLength(1) @maxLength(119) title:string;
    @initial("draft") status:string;
  }
  @entity @view("Renglones")
  model OrderLine {
    @publicIdentity @unique @minLength(1) @maxLength(40) lineCode:string;
    @reference("PurchaseOrder","restrict") @minLength(1) @maxLength(40) orderCode:string;
    @minLength(1) @maxLength(120) product:string;
    @minValue(1) @maxValue(100) units:int32;
  }
  model OrderLineInput {
    @minLength(1) @maxLength(40) lineCode:string;
    @minLength(1) @maxLength(120) product:string;
    @minValue(1) @maxValue(100) units:int32;
  }
  model ReplaceOrderLines {
    @minItems(1) @maxItems(20) lines:OrderLineInput[];
  }
  model PurchaseOrderRequest {
    @minLength(1) @maxLength(40) code:string;
    @minLength(1) @maxLength(119) title:string;
    @minItems(1) @maxItems(20) lines:OrderLineInput[];
  }
  model ProductChange {
    @minLength(1) @maxLength(120) product:string;
    @minLength(1) @maxLength(120) expected:string;
  }
  model QuantityChange { @minValue(1) @maxValue(100) units:int32;
    @minValue(1) @maxValue(100) expected:int32; }
  model OrderTotal { totalUnits:string; }
  model OrderLineRequest {
    @minLength(1) @maxLength(40) lineCode:string;
    @minLength(1) @maxLength(40) orderCode:string;
    @minLength(1) @maxLength(120) product:string;
    @minValue(1) @maxValue(100) units:int32;
  }
  model VersionedPurchaseOrder {code:string;title:string;status:string;documentVersion:int32;}
  model PurchaseOrderPage {items:PurchaseOrder[];@minValue(1) @maxValue(50) limit:int32;@minValue(0) offset:int32;@minValue(0) total:int32;}
  model OrderLinePage {items:OrderLine[];@minValue(1) @maxValue(50) limit:int32;@minValue(0) offset:int32;@minValue(0) total:int32;}
  model Health {status:string;}
  @error model Missing {@statusCode _:404;message:string;}
  @error model Invalid {@statusCode _:400;message:string;}
  @error model Conflict {@statusCode _:409;message:string;}
  @error model Unauthorized {@statusCode _:401;message:string;}
  @error model Forbidden {@statusCode _:403;message:string;}
  @route("/api/orders")
  @post @behavior("create","PurchaseOrder")
  @createDetails("OrderLine","orderCode","lines")
  @versionedDetails("status","closed")
  @capability("orders.write")
  op createPurchaseOrder(@body input:PurchaseOrderRequest):
    {@statusCode _:201;@body result:VersionedPurchaseOrder;} | Invalid | Conflict | Unauthorized | Forbidden;
  @route("/api/orders/{code}/close")
  @post @behavior("transition","PurchaseOrder","status")
  @transition("draft","closed") @audit("status") @capability("orders.write")
  op closePurchaseOrder(@path code:string,@header("If-Match") ifMatch:string):
    VersionedPurchaseOrder | Invalid | Conflict | Missing | Unauthorized | Forbidden;
  @route("/api/orders/{code}/lines")
  @put @behavior("replaceDetails","PurchaseOrder") @replaceDetails
  @capability("orders.write")
  op replaceOrderLines(@path code:string,@header("If-Match") ifMatch:string,
    @body input:ReplaceOrderLines):
    VersionedPurchaseOrder | Invalid | Conflict | Missing | Unauthorized | Forbidden;
  @route("/api/orders/{code}/total")
  @get @behavior("sumDetails","PurchaseOrder")
  @detailSum("OrderLine","orderCode","units") @capability("orders.read")
  op totalUnits(@path code:string):OrderTotal | Missing | Unauthorized | Forbidden;
  @route("/api/orders/{code}")
  @get @behavior("get","PurchaseOrder") @capability("orders.read")
  op getPurchaseOrder(@path code:string):VersionedPurchaseOrder | Missing | Unauthorized | Forbidden;
  @route("/api/orders")
  @get @behavior("listPage","PurchaseOrder") @capability("orders.read")
  op listPurchaseOrders(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    PurchaseOrderPage | Invalid | Unauthorized | Forbidden;
  @route("/api/order-lines")
  @post @behavior("create","OrderLine") @audit("orderCode,product,units") @capability("lines.write")
  op createOrderLine(@header("If-Match") ifMatch:string,@body input:OrderLineRequest):
    {@statusCode _:201;@body result:OrderLine;} | Invalid | Conflict | Unauthorized | Forbidden;
  // B16: second independently authorized audited edit on the same child.
  @route("/api/order-lines/{lineCode}/product")
  @patch @behavior("patchFields","OrderLine","product","product")
  @audit("product") @capability("lines.product.write")
  op patchLineProduct(@path lineCode:string,@header("If-Match") ifMatch:string,@body input:ProductChange):
    OrderLine | Invalid | Conflict | Missing | Unauthorized | Forbidden;
  @route("/api/order-lines/{lineCode}/units")
  @patch @behavior("patchFields","OrderLine","units","units")
  @audit("units") @capability("lines.write")
  op patchLineUnits(@path lineCode:string,@header("If-Match") ifMatch:string,@body input:QuantityChange):
    OrderLine | Invalid | Conflict | Missing | Unauthorized | Forbidden;
  @route("/api/order-lines/{lineCode}")
  @delete @behavior("delete","OrderLine") @audit("orderCode,product,units")
  @capability("lines.write")
  op deleteOrderLine(@path lineCode:string,@header("If-Match") ifMatch:string):
    {@statusCode _:204;} | Invalid | Conflict | Missing | Unauthorized | Forbidden;
  @route("/api/order-lines/{lineCode}")
  @get @behavior("get","OrderLine") @capability("lines.read")
  op getOrderLine(@path lineCode:string):OrderLine | Missing | Unauthorized | Forbidden;
  @route("/api/order-lines")
  @get @behavior("listPage","OrderLine") @capability("lines.read")
  op listOrderLines(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    OrderLinePage | Invalid | Unauthorized | Forbidden;
  // B13: indexed, deterministic, identity-scoped rows within one PurchaseOrder.
  @route("/api/order-lines/query/by-order")
  @get @behavior("queryPage","OrderLine") @queryOrder("lineCode","asc")
  @capability("lines.read")
  op queryOrderLines(
    @query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0,
    @query @queryFilter("orderCode","eq") orderCode?:string
  ): OrderLinePage | Invalid | Unauthorized | Forbidden;

  @route("/health") @get @behavior("health","PurchaseOrder") @capability("public")
  op health():Health;
}
