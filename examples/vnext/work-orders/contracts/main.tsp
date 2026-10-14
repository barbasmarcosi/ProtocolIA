import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Work Orders" })
namespace WorkOrders {
  @entity
  @view("Órdenes de trabajo")
  model WorkOrder {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    code: string;
    @minLength(1) @maxLength(120)
    title: string;
    @initial("draft") @minLength(1) @maxLength(20)
    status: string;
  }
  model WorkOrderRequest {
    @minLength(1) @maxLength(40) code: string;
    @minLength(1) @maxLength(120) title: string;
    @minLength(1) @maxLength(20) status: string;
  }
  model WorkOrderPage {
    items: WorkOrder[];
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

  @route("/api/work-orders")
  @post @behavior("create", "WorkOrder") @capability("orders.write")
  op createWorkOrder(@body input: WorkOrderRequest):
    { @statusCode _: 201; @body record: WorkOrder; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/work-orders/{code}")
  @get @behavior("get", "WorkOrder") @capability("orders.read")
  op getWorkOrder(@path code: string): WorkOrder | NotFound | Unauthorized | Forbidden;

  @route("/api/work-orders")
  @get @behavior("listPage", "WorkOrder") @capability("orders.read")
  op listWorkOrders(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): WorkOrderPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/work-orders/{code}/approve")
  @post @behavior("transition", "WorkOrder", "status")
  @transition("draft", "approved")
  @capability("orders.write")
  op approveWorkOrder(@path code: string):
    WorkOrder | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/work-orders/{code}/close")
  @post @behavior("transition", "WorkOrder", "status")
  @transition("approved", "closed")
  @capability("orders.write")
  op closeWorkOrder(@path code: string):
    WorkOrder | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health", "WorkOrder") @capability("public")
  op health(): Health;
}
