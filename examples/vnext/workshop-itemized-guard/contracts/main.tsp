import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

// Financial acceptance: bounded exact multi-charge + authoritative PostgreSQL
// receipt-coverage snapshot (v1.2h-S1), not real payment-provider settlement.
// Frozen scope: docs/vnext/acceptance/V12H_S1_LEDGER_COVERAGE_20261030.md.
@service(#{ title: "Taller Ledger — immutable exact itemized charges" })
namespace TallerPaymentGuard {
  enum PaymentMethod {
    Cash: "cash",
    BankTransfer: "bank_transfer",
    Card: "card",
  }
  model Health { status: string; }
  model ExactLedgerSnapshot {
    openingBalance: string;
    available: string;
    postedTotal: string;
    reversedTotal: string;
    expectedAvailable: string;
    difference: string;
    postingCount: string;
    adjustmentCount: string;
    balanced: boolean;
    coverageState: string;
    // S2c-1a: advisory exact headroom, NEVER authority to mutate.
    adjustmentPreviewEligible: boolean;
    maxSafeDecrease: string;
    maxSafeIncrease: string;
  }
  @error model BadRequest { @statusCode _: 400; message: string; }
  @error model Unauthorized { @statusCode _: 401; message: string; }
  @error model Forbidden { @statusCode _: 403; message: string; }
  @error model NotFound { @statusCode _: 404; message: string; }
  @error model Conflict { @statusCode _: 409; message: string; }

  @entity
  @view("Clientes")
  model Customer {
    @publicIdentity @unique @minLength(1) @maxLength(32)
    customerCode: string;
    @minLength(1) @maxLength(120)
    name: string;
    @minLength(1) @maxLength(90)
    contactNote: string;
  }

  model CustomerRequest {
    @minLength(1) @maxLength(32) customerCode: string;
    @minLength(1) @maxLength(120) name: string;
    @minLength(1) @maxLength(90) contactNote: string;
  }
  model CustomerPage {
    items: Customer[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity
  @view("Vehículos")
  model Vehicle {
    @publicIdentity @unique @minLength(1) @maxLength(32)
    plate: string;
    @reference("Customer","restrict") @minLength(1) @maxLength(32)
    customerCode: string;
    @minLength(1) @maxLength(80)
    modelName: string;
    @minValue(0)
    mileageKm: int32;
  }

  model VehicleRequest {
    @minLength(1) @maxLength(32) plate: string;
    @minLength(1) @maxLength(32) customerCode: string;
    @minLength(1) @maxLength(80) modelName: string;
    @minValue(0) mileageKm: int32;
  }
  model VehiclePage {
    items: Vehicle[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity
  @view("Órdenes de trabajo")
  model WorkOrder {
    @publicIdentity @unique @minLength(1) @maxLength(32)
    number: string;
    @reference("Vehicle","restrict") @minLength(1) @maxLength(32)
    vehiclePlate: string;
    @minLength(1) @maxLength(160)
    symptom: string;
    // Charge total is derived exclusively from immutable typed charge lines.
    @encode(string) @exactDecimal(14,2,"0","999999999999.99")
    chargeTotal: decimal;
    // Exact opening and availability are derived from the recorded line sum.
    @encode(string) @exactDecimal(14,2,"0","999999999999.99")
    openingBalance: decimal;
    @encode(string) @exactDecimal(14,2,"0","999999999999.99")
    available: decimal;
    @initial("opened") @minLength(1) @maxLength(20)
    status: string;
    openedAt?: utcDateTime | null;
  }

  model WorkOrderRequest {
    @minLength(1) @maxLength(32) number: string;
    @minLength(1) @maxLength(32) vehiclePlate: string;
    @minLength(1) @maxLength(160) symptom: string;
    // No scalar amount is accepted from the client.
    @minItems(1) @maxItems(20) charges: ChargeLineInput[];
    openedAt?: utcDateTime | null;
  }
  model WorkOrderPage {
    items: WorkOrder[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  enum ChargeKind { Labor: "labor", Parts: "parts" }
  @entity
  @view("Conceptos cobrables")
  model ChargeLine {
    @publicIdentity @unique @minLength(1) @maxLength(32)
    lineId: string;
    @reference("WorkOrder","restrict") @minLength(1) @maxLength(32)
    orderNumber: string;
    kind: ChargeKind;
    @minLength(1) @maxLength(120)
    description: string;
    @encode(string) @exactDecimal(14,2,"0","999999999999.99")
    amount: decimal;
  }
  model ChargeLineInput {
    @minLength(1) @maxLength(32) lineId: string;
    kind: ChargeKind;
    @minLength(1) @maxLength(120) description: string;
    @encode(string) @exactDecimal(14,2,"0","999999999999.99")
    amount: decimal;
  }
  model ChargeLineRequest {
    @minLength(1) @maxLength(32) lineId: string;
    @minLength(1) @maxLength(32) orderNumber: string;
    kind: ChargeKind;
    @minLength(1) @maxLength(120) description: string;
    @encode(string) @exactDecimal(14,2,"0","999999999999.99")
    amount: decimal;
  }
  model ChargeLinePage {
    items: ChargeLine[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity
  @view("Cobros")
  model Payment {
    @publicIdentity @unique @minLength(1) @maxLength(32)
    receipt: string;
    @reference("WorkOrder","restrict") @minLength(1) @maxLength(32)
    orderNumber: string;
    @encode(string) @exactDecimal(14,2,"0.01","999999999999.99")
    amount: decimal;
    method: PaymentMethod;
    @minLength(1) @maxLength(90)
    destinationAccount: string;
    @initial("posted") @minLength(1) @maxLength(20)
    status: string;
  }

  model PaymentRequest {
    @minLength(1) @maxLength(32) receipt: string;
    @minLength(1) @maxLength(32) orderNumber: string;
    @encode(string) @exactDecimal(14,2,"0.01","999999999999.99")
    amount: decimal;
    method: PaymentMethod;
    @minLength(1) @maxLength(90) destinationAccount: string;
  }
  model PaymentPage {
    items: Payment[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @route("/api/customers")
  @post @behavior("create","Customer") @capability("customers.write")
  op createCustomer(@body input: CustomerRequest):
    { @statusCode _: 201; @body item: Customer; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/customers/{customerCode}")
  @get @behavior("get","Customer") @capability("customers.read")
  op getCustomer(@path customerCode: string):
    Customer | NotFound | Unauthorized | Forbidden;

  @route("/api/customers")
  @get @behavior("listPage","Customer") @capability("customers.read")
  op listCustomer(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): CustomerPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/customers/{customerCode}")
  @delete @behavior("delete","Customer") @capability("customers.write")
  op deleteCustomer(@path customerCode: string):
    { @statusCode _: 204; } | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/vehicles")
  @post @behavior("create","Vehicle") @capability("vehicles.write")
  op createVehicle(@body input: VehicleRequest):
    { @statusCode _: 201; @body item: Vehicle; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/vehicles/{plate}")
  @get @behavior("get","Vehicle") @capability("vehicles.read")
  op getVehicle(@path plate: string):
    Vehicle | NotFound | Unauthorized | Forbidden;

  @route("/api/vehicles")
  @get @behavior("listPage","Vehicle") @capability("vehicles.read")
  op listVehicle(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): VehiclePage | BadRequest | Unauthorized | Forbidden;

  @route("/api/vehicles/{plate}")
  @delete @behavior("delete","Vehicle") @capability("vehicles.write")
  op deleteVehicle(@path plate: string):
    { @statusCode _: 204; } | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/work-orders")
  @post @behavior("create","WorkOrder") @audit("symptom,status,chargeTotal")
  @createDetails("ChargeLine","orderNumber","charges","amount","chargeTotal")
  @capability("orders.write")
  op createWorkOrder(@body input: WorkOrderRequest):
    { @statusCode _: 201; @body item: WorkOrder; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/work-orders/{number}")
  @get @behavior("get","WorkOrder") @capability("orders.read")
  op getWorkOrder(@path number: string):
    WorkOrder | NotFound | Unauthorized | Forbidden;

  @route("/api/work-orders")
  @get @behavior("listPage","WorkOrder") @capability("orders.read")
  op listWorkOrder(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): WorkOrderPage | BadRequest | Unauthorized | Forbidden;

  // Financial work orders are immutable once registered; do not offer generic DELETE.

  // The compiler requires a typed child create declaration, but the generated
  // runtime refuses direct financial child POST with HTTP 409.
  @route("/api/charge-lines")
  @post @behavior("create","ChargeLine") @capability("charges.write")
  op createChargeLine(@body input: ChargeLineRequest):
    { @statusCode _: 201; @body item: ChargeLine; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/charge-lines/{lineId}")
  @get @behavior("get","ChargeLine") @capability("charges.read")
  op getChargeLine(@path lineId: string):
    ChargeLine | NotFound | Unauthorized | Forbidden;

  @route("/api/charge-lines")
  @get @behavior("listPage","ChargeLine") @capability("charges.read")
  op listChargeLines(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): ChargeLinePage | BadRequest | Unauthorized | Forbidden;

  @route("/api/payments")
  @post @behavior("create","Payment")
  @debitExact("WorkOrder","available","orderNumber","amount")
  @audit("amount") @capability("payments.write")
  op createPayment(@body input: PaymentRequest):
    { @statusCode _: 201; @body item: Payment; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/payments/{receipt}")
  @get @behavior("get","Payment") @capability("payments.read")
  op getPayment(@path receipt: string):
    Payment | NotFound | Unauthorized | Forbidden;

  @route("/api/payments")
  @get @behavior("listPage","Payment") @capability("payments.read")
  op listPayment(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): PaymentPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/payments/{receipt}/reverse")
  @post @behavior("transition","Payment","status")
  @transition("posted","reversed")
  @reverseExact("WorkOrder","available","orderNumber","amount")
  @audit("status") @capability("payments.write")
  op reversePayment(@path receipt: string):
    Payment | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  // S2c-1b1: authenticated, append-only signed correction, not a charge PATCH.
  model ExactAdjustmentRequest {
    @minLength(8) @maxLength(64) adjustmentId: string;
    @encode(string) @exactDecimal(14,2,"-999999999999.99","999999999999.99")
    delta: decimal;
    @minLength(12) @maxLength(240) reason: string;
    @encode(string) @exactDecimal(14,2,"0.00","999999999999.99") expectedOpening: decimal;
    @encode(string) @exactDecimal(14,2,"0.00","999999999999.99") expectedAvailable: decimal;
    @minLength(1) @maxLength(16) expectedPostingCount: string;
    @encode(string) @exactDecimal(14,2,"0.00","999999999999.99") expectedReversedTotal: decimal;
    @minLength(1) @maxLength(3) expectedAdjustmentCount: string;
  }

  @route("/api/work-orders/{number}/adjustments")
  @post @behavior("adjustExact","WorkOrder") @capability("orders.adjust")
  op adjustWorkOrder(@path number: string, @body input: ExactAdjustmentRequest):
    { @statusCode _: 201; @body item: WorkOrder; }
    | Conflict | BadRequest | NotFound | Unauthorized | Forbidden;

  // Read-only recovery of a COMMITTED internal correction after a lost HTTP response.
  // A missing result never authorizes an automatic retry or external settlement.
  model ExactAdjustmentOutcome {
    @minLength(8) @maxLength(64) adjustmentId: string;
    @encode(string) @exactDecimal(14,2,"-999999999999.99","999999999999.99")
    delta: decimal;
    @minLength(12) @maxLength(240) reason: string;
    status: "committed";
  }

  @route("/api/work-orders/{number}/adjustments/{adjustmentId}")
  @get @behavior("lookupExactAdjustment","WorkOrder") @capability("orders.adjust")
  op lookupWorkOrderAdjustment(@path number: string, @path @minLength(8) @maxLength(64) adjustmentId: string):
    ExactAdjustmentOutcome | BadRequest | NotFound | Unauthorized | Forbidden;

  @route("/api/work-orders/{number}/reconciliation")
  @get @behavior("reconcileExact","WorkOrder")
  @reconcileExact("openingBalance","available","Payment","orderNumber","amount","status","posted","reversed","chargeTotal", true, true, true, true)
  @capability("orders.read")
  op reconcileWorkOrder(@path number: string):
    ExactLedgerSnapshot | NotFound | Unauthorized | Forbidden;

  @route("/api/work-orders/query/filtered")
  @get @behavior("queryPage","WorkOrder")
  @queryOrder("status","asc") @capability("orders.read")
  op searchWorkOrders(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0,
    @query @queryFilter("status","eq") status?: string
  ): WorkOrderPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/work-orders/{number}/start")
  @post @behavior("transition","WorkOrder","status")
  @transition("opened","underway") @audit("status") @capability("orders.write")
  op startWorkOrder(@path number: string):
    WorkOrder | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/work-orders/{number}/finish")
  @post @behavior("transition","WorkOrder","status")
  @transition("underway","finished") @audit("status") @capability("orders.write")
  op finishWorkOrder(@path number: string):
    WorkOrder | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  model AuditEntry {
    id: string;
    actor: string;
    entityName: string;
    resourceId: string;
    operationName: string;
    fieldName: string;
    beforeValue: string | null;
    afterValue: string | null;
    occurredAt: utcDateTime;
  }
  model AuditPage {
    items: AuditEntry[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  @route("/api/work-orders/{number}/audit")
  @get @behavior("auditPage","WorkOrder") @capability("orders.audit")
  op listWorkOrderAudit(
    @path number: string,
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): AuditPage | NotFound | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health","Customer") @capability("public")
  op health(): Health;
}
