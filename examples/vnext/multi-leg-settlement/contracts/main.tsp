import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{title:"B10 multi-partida: liquidación neta indivisible"})
namespace MultiLeg {
  @entity @view("Existencias")
  model Bin {
    @publicIdentity @unique @minLength(1) @maxLength(40) sku:string;
    @minLength(1) @maxLength(120) name:string;
    @minValue(0) @maxValue(100) available:int32;
  }
  @entity @view("Movimientos multipardita")
  model Batch {
    @publicIdentity @unique @minLength(1) @maxLength(40) number:string;
    @reference("Bin","restrict") @minLength(1) @maxLength(40) sourceSku1:string;
    @reference("Bin","restrict") @minLength(1) @maxLength(40) targetSku1:string;
    @minValue(1) @maxValue(80) units1:int32;
    @reference("Bin","restrict") @minLength(1) @maxLength(40) sourceSku2:string;
    @reference("Bin","restrict") @minLength(1) @maxLength(40) targetSku2:string;
    @minValue(1) @maxValue(80) units2:int32;
    @minLength(1) @maxLength(120) note:string;
  }
  model BinRequest {
    @minLength(1) @maxLength(40) sku:string;
    @minLength(1) @maxLength(120) name:string;
    @minValue(0) @maxValue(100) available:int32;
  }
  model BatchRequest {
    @minLength(1) @maxLength(40) number:string;
    @minLength(1) @maxLength(40) sourceSku1:string;
    @minLength(1) @maxLength(40) targetSku1:string;
    @minValue(1) @maxValue(80) units1:int32;
    @minLength(1) @maxLength(40) sourceSku2:string;
    @minLength(1) @maxLength(40) targetSku2:string;
    @minValue(1) @maxValue(80) units2:int32;
    @minLength(1) @maxLength(120) note:string;
  }
  model BinPage {items:Bin[];@minValue(1) @maxValue(50) limit:int32;@minValue(0) offset:int32;@minValue(0) total:int32;}
  model BatchPage {items:Batch[];@minValue(1) @maxValue(50) limit:int32;@minValue(0) offset:int32;@minValue(0) total:int32;}
  model Health {status:string;}
  @error model Missing {@statusCode _:404;message:string;}
  @error model Invalid {@statusCode _:400;message:string;}
  @error model Conflict {@statusCode _:409;message:string;}
  @error model Unauthorized {@statusCode _:401;message:string;}
  @error model Forbidden {@statusCode _:403;message:string;}

  @route("/api/bins")
  @post @behavior("create","Bin") @capability("bins.write")
  op createBin(@body input:BinRequest):
    {@statusCode _:201;@body result:Bin;} | Invalid | Conflict | Unauthorized | Forbidden;
  @route("/api/bins/{sku}")
  @get @behavior("get","Bin") @capability("bins.read")
  op getBin(@path sku:string):Bin | Missing | Unauthorized | Forbidden;
  @route("/api/bins")
  @get @behavior("listPage","Bin") @capability("bins.read")
  op listBins(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    BinPage | Invalid | Unauthorized | Forbidden;

  @route("/api/batches")
  @post @behavior("create","Batch")
  @moveBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku2,targetSku2,units2")
  @capability("batches.write")
  op createBatch(@body input:BatchRequest):
    {@statusCode _:201;@body result:Batch;} | Invalid | Conflict | Unauthorized | Forbidden;
  @route("/api/batches/{number}")
  @get @behavior("get","Batch") @capability("batches.read")
  op getBatch(@path number:string):Batch | Missing | Unauthorized | Forbidden;
  @route("/api/batches")
  @get @behavior("listPage","Batch") @capability("batches.read")
  op listBatches(@query @minValue(1) @maxValue(50) limit?:int32=25,
    @query @minValue(0) @maxValue(1000000) offset?:int32=0):
    BatchPage | Invalid | Unauthorized | Forbidden;

  @route("/health") @get @behavior("health","Bin") @capability("public")
  op health():Health;
}
