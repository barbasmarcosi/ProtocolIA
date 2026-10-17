import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{title:"Inventory transfers — two locked parents and durable movement"})
namespace StockTransfers {
  @entity @view("Depósitos")
  model Bin {
    @publicIdentity @unique @minLength(1) @maxLength(40) sku: string;
    @minLength(1) @maxLength(120) name: string;
    @minValue(0) @maxValue(100) available: int32;
  }
  @entity @view("Movimientos")
  model Movement {
    @publicIdentity @unique @minLength(1) @maxLength(40) number: string;
    @reference("Bin","restrict")
    @minLength(1) @maxLength(40) sourceSku: string;
    @reference("Bin","restrict")
    @minLength(1) @maxLength(40) targetSku: string;
    @minValue(1) @maxValue(60) units: int32;
    @minLength(1) @maxLength(150) note: string;
  }
  model BinRequest {
    @minLength(1) @maxLength(40) sku: string;
    @minLength(1) @maxLength(120) name: string;
    @minValue(0) @maxValue(100) available: int32;
  }
  model MovementRequest {
    @minLength(1) @maxLength(40) number: string;
    @minLength(1) @maxLength(40) sourceSku: string;
    @minLength(1) @maxLength(40) targetSku: string;
    @minValue(1) @maxValue(60) units: int32;
    @minLength(1) @maxLength(150) note: string;
  }
  model BinPage {
    items: Bin[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model MovementPage {
    items: Movement[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  model Health {status:string;}
  @error model NotFound {@statusCode _:404;message:string;}
  @error model BadRequest {@statusCode _:400;message:string;}
  @error model Conflict {@statusCode _:409;message:string;}
  @error model Unauthorized {@statusCode _:401;message:string;}
  @error model Forbidden {@statusCode _:403;message:string;}

  @route("/api/bins")
  @post @behavior("create","Bin") @capability("bins.write")
  op createBin(@body input:BinRequest):
    {@statusCode _:201;@body result:Bin;} | Conflict | BadRequest | Unauthorized | Forbidden;
  @route("/api/bins/{sku}")
  @get @behavior("get","Bin") @capability("bins.read")
  op getBin(@path sku:string):Bin | NotFound | Unauthorized | Forbidden;
  @route("/api/bins")
  @get @behavior("listPage","Bin") @capability("bins.read")
  op listBins(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    BinPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/movements")
  @post @behavior("create","Movement")
  @moveUnits("Bin","available","sourceSku","targetSku","units")
  @capability("movements.write")
  op createMovement(@body input:MovementRequest):
    {@statusCode _:201;@body result:Movement;} | Conflict | BadRequest | Unauthorized | Forbidden;
  @route("/api/movements/{number}")
  @get @behavior("get","Movement") @capability("movements.read")
  op getMovement(@path number:string):Movement | NotFound | Unauthorized | Forbidden;
  @route("/api/movements")
  @get @behavior("listPage","Movement") @capability("movements.read")
  op listMovements(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    MovementPage | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health","Bin") @capability("public")
  op health():Health;
}
