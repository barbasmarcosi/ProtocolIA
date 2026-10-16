import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Gauge Registry" })
namespace GaugeRegistry {
  enum GaugeQuality {
    Ready: "ready",
    NeedsService: "needs_service",
    Retired: "retired",
  }

  @entity
  @view("Registro de instrumentos")
  model Gauge {
    @publicIdentity
    @unique
    @minLength(1)
    @maxLength(40)
    serial: string;

    @minLength(1)
    @maxLength(90)
    label: string;

    @minValue(0)
    reading: int32;

    // Omitted and explicit null remain different in request semantics.
    @uiLabel("Estado de conservación")
    quality?: GaugeQuality;
    @uiLabel("Motivo del mantenimiento")
    @uiHelp("Explicá por qué el instrumento requiere servicio.")
    @requiredWhen("quality","needs_service")
    @minLength(5) @maxLength(160)
    maintenanceReason?: string;
    calibratedAt?: utcDateTime | null;

    // Native exact decimal; HTTP JSON strings, never binary floats.
    @uiLabel("Precio unitario")
    @encode(string)
    @exactDecimal(24, 4, "0", "99999999999999999999.9999")
    unitPrice: decimal;

    @uiLabel("Límite de precio")
    @encode(string)
    @exactDecimal(24, 4, "0")
    @greaterThanField("unitPrice")
    priceCeiling?: decimal;

    @uiLabel("Límite de cantidad")
    @encode(string)
    @exactDecimal(16, 4, "0")
    @greaterThanField("quantity")
    quantityLimit?: decimal;

    @uiLabel("Tarifa calculable")
    @encode(string)
    @exactDecimal(12, 4, "0")
    unitRate: decimal;

    @uiLabel("Unidades del lote")
    @encode(string)
    @exactDecimal(14, 3, "0")
    batchUnits: decimal;

    @uiLabel("Importe exacto")
    @encode(string)
    @exactDecimal(26, 7, "0")
    @computedProduct("unitRate","batchUnits")
    extendedValue: decimal;

    @uiLabel("Costo")
    @encode(string)
    @exactDecimal(24, 4, "0")
    cost?: decimal | null;

    @uiLabel("Porcentaje")
    @encode(string)
    @exactDecimal(7, 3, "0", "100")
    percentage?: decimal;

    @uiLabel("Cantidad")
    @encode(string)
    @exactDecimal(16, 6, "0.000001", "9999999999.999999")
    quantity: decimal;
  }

  model GaugeRequest {
    @minLength(1)
    @maxLength(40)
    serial: string;
    @minLength(1)
    @maxLength(90)
    label: string;
    @minValue(0)
    reading: int32;
    @uiLabel("Estado de conservación")
    quality?: GaugeQuality;
    @minLength(5) @maxLength(160)
    maintenanceReason?: string;
    calibratedAt?: utcDateTime | null;

    // Native exact decimal; HTTP JSON strings, never binary floats.
    @uiLabel("Precio unitario")
    @encode(string)
    @exactDecimal(24, 4, "0", "99999999999999999999.9999")
    unitPrice: decimal;

    @uiLabel("Límite de precio")
    @encode(string)
    @exactDecimal(24, 4, "0")
    priceCeiling?: decimal;

    @uiLabel("Límite de cantidad")
    @encode(string)
    @exactDecimal(16, 4, "0")
    quantityLimit?: decimal;

    @uiLabel("Tarifa calculable")
    @encode(string)
    @exactDecimal(12, 4, "0")
    unitRate: decimal;

    @uiLabel("Unidades del lote")
    @encode(string)
    @exactDecimal(14, 3, "0")
    batchUnits: decimal;

    @uiLabel("Costo")
    @encode(string)
    @exactDecimal(24, 4, "0")
    cost?: decimal | null;

    @uiLabel("Porcentaje")
    @encode(string)
    @exactDecimal(7, 3, "0", "100")
    percentage?: decimal;

    @uiLabel("Cantidad")
    @encode(string)
    @exactDecimal(16, 6, "0.000001", "9999999999.999999")
    quantity: decimal;
  }

  model ReadingAdjustment {
    @minValue(1)
    @maxValue(25)
    delta: int32;
  }
  model GaugeLabelChange {
    @minLength(1)
    @maxLength(90)
    label: string;
  }
  model GaugePage {
    items: Gauge[];
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

  @route("/api/gauges")
  @post
  @behavior("create", "Gauge")
  @capability("gauges.write")
  op createGauge(@body input: GaugeRequest):
      { @statusCode _: 201; @body gauge: Gauge; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/gauges/{serial}")
  @get
  @behavior("get", "Gauge")
  @capability("gauges.read")
  op getGauge(@path serial: string): Gauge | NotFound | Unauthorized | Forbidden;

  @route("/api/gauges")
  @get
  @behavior("listPage", "Gauge")
  @capability("gauges.read")
  op listGauges(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): GaugePage | BadRequest | Unauthorized | Forbidden;

  @route("/api/gauges/{serial}/reading")
  @patch
  @behavior("atomicIncrement", "Gauge", "reading", "delta")
  @capability("gauges.write")
  op increaseReading(@path serial: string, @body input: ReadingAdjustment):
      Gauge | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/gauges/{serial}/label")
  @patch
  @behavior("patchFields", "Gauge", "label", "label")
  @capability("gauges.write")
  op relabelGauge(@path serial: string, @body input: GaugeLabelChange):
      Gauge | NotFound | BadRequest | Unauthorized | Forbidden;

  @route("/api/gauges/{serial}")
  @delete
  @behavior("delete", "Gauge")
  @capability("gauges.write")
  op deleteGauge(@path serial: string): { @statusCode _: 204; }
      | NotFound | Unauthorized | Forbidden;

  @route("/health")
  @get
  @behavior("health", "Gauge")
  @capability("public")
  op health(): Health;
}
