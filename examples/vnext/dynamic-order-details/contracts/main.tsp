import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{title:"B12 dynamic purchase orders"})
namespace DynamicOrders {
  @entity @view("Órdenes")
  model Order {
    @publicIdentity @unique @minLength(1) @maxLength(40) code:string;
    @minLength(1) @maxLength(120) title:string;
  }
  @entity @view("Renglones")
  model OrderLine {
    @publicIdentity @unique @minLength(1) @maxLength(40) lineCode:string;
    @reference("Order","restrict") @minLength(1) @maxLength(40) orderCode:string;
    @minLength(1) @maxLength(120) product:string;
    @minValue(1) @maxValue(100) units:int32;
  }
  model OrderLineInput {
    @minLength(1) @maxLength(40) lineCode:string;
    @minLength(1) @maxLength(120) product:string;
    @minValue(1) @maxValue(100) units:int32;
  }
  model OrderRequest {
    @minLength(1) @maxLength(40) code:string;
    @minLength(1) @maxLength(120) title:string;
    @minItems(1) @maxItems(20) lines:OrderLineInput[];
  }
  model OrderLineRequest {
    @minLength(1) @maxLength(40) lineCode:string;
    @minLength(1) @maxLength(40) orderCode:string;
    @minLength(1) @maxLength(120) product:string;
    @minValue(1) @maxValue(100) units:int32;
  }
  model OrderPage {items:Order[];@minValue(1) @maxValue(50) limit:int32;@minValue(0) offset:int32;@minValue(0) total:int32;}
  model OrderLinePage {items:OrderLine[];@minValue(1) @maxValue(50) limit:int32;@minValue(0) offset:int32;@minValue(0) total:int32;}
  model Health {status:string;}
  @error model Missing {@statusCode _:404;message:string;}
  @error model Invalid {@statusCode _:400;message:string;}
  @error model Conflict {@statusCode _:409;message:string;}
  @error model Unauthorized {@statusCode _:401;message:string;}
  @error model Forbidden {@statusCode _:403;message:string;}
  @route("/api/orders")
  @post @behavior("create","Order")
  @createDetails("OrderLine","orderCode","lines")
  @capability("orders.write")
  op createOrder(@body input:OrderRequest):
    {@statusCode _:201;@body result:Order;} | Invalid | Conflict | Unauthorized | Forbidden;
  @route("/api/orders/{code}")
  @get @behavior("get","Order") @capability("orders.read")
  op getOrder(@path code:string):Order | Missing | Unauthorized | Forbidden;
  @route("/api/orders")
  @get @behavior("listPage","Order") @capability("orders.read")
  op listOrders(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    OrderPage | Invalid | Unauthorized | Forbidden;
  @route("/api/order-lines")
  @post @behavior("create","OrderLine") @capability("lines.write")
  op createOrderLine(@body input:OrderLineRequest):
    {@statusCode _:201;@body result:OrderLine;} | Invalid | Conflict | Unauthorized | Forbidden;
  @route("/api/order-lines/{lineCode}")
  @get @behavior("get","OrderLine") @capability("lines.read")
  op getOrderLine(@path lineCode:string):OrderLine | Missing | Unauthorized | Forbidden;
  @route("/api/order-lines")
  @get @behavior("listPage","OrderLine") @capability("lines.read")
  op listOrderLines(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    OrderLinePage | Invalid | Unauthorized | Forbidden;
  @route("/health") @get @behavior("health","Order") @capability("public")
  op health():Health;
}
