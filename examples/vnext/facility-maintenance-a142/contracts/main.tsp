import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

@service(#{ title: "Facility Maintenance — Independent Product Acceptance" })
namespace FacilityMaintenance {
  @entity
  @view("Sedes")
  model Site {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    code: string;
    @minLength(1) @maxLength(120)
    name: string;
    @minLength(1) @maxLength(180)
    address: string;
  }
  model SiteRequest {
    @minLength(1) @maxLength(40) code: string;
    @minLength(1) @maxLength(120) name: string;
    @minLength(1) @maxLength(180) address: string;
  }
  model SitePage {
    items: Site[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  @entity
  @view("Máquinas")
  model Machine {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    tag: string;
    @reference("Site","restrict") @minLength(1) @maxLength(40)
    siteCode: string;
    @minLength(1) @maxLength(120)
    name: string;
    @minLength(1) @maxLength(70)
    category: string;
  }
  model MachineRequest {
    @minLength(1) @maxLength(40) tag: string;
    @minLength(1) @maxLength(40) siteCode: string;
    @minLength(1) @maxLength(120) name: string;
    @minLength(1) @maxLength(70) category: string;
  }
  model MachinePage {
    items: Machine[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  @entity
  @view("Técnicos")
  model Technician {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    badge: string;
    @minLength(1) @maxLength(120)
    name: string;
    @minLength(1) @maxLength(80)
    skill: string;
  }
  model TechnicianRequest {
    @minLength(1) @maxLength(40) badge: string;
    @minLength(1) @maxLength(120) name: string;
    @minLength(1) @maxLength(80) skill: string;
  }
  model TechnicianPage {
    items: Technician[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }
  @entity
  @view("Avisos de mantenimiento")
  model Ticket {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    number: string;
    @reference("Machine","restrict") @minLength(1) @maxLength(40)
    machineTag: string;
    @reference("Technician","restrict") @minLength(1) @maxLength(40)
    technicianBadge: string;
    @minLength(1) @maxLength(160)
    title: string;
    @minLength(1) @maxLength(30)
    severity: string;
    dueAt?: utcDateTime | null;
    @initial("reported") @minLength(1) @maxLength(20)
    status: string;
  }
  model TicketRequest {
    @minLength(1) @maxLength(40) number: string;
    @minLength(1) @maxLength(40) machineTag: string;
    @minLength(1) @maxLength(40) technicianBadge: string;
    @minLength(1) @maxLength(160) title: string;
    @minLength(1) @maxLength(30) severity: string;
    dueAt?: utcDateTime | null;
    @minLength(1) @maxLength(20) status: string;
  }
  model TicketPage {
    items: Ticket[];
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

  @route("/api/sites")
  @post @behavior("create","Site") @capability("sites.write")
  op createSite(@body input: SiteRequest):
    { @statusCode _: 201; @body item: Site; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/sites/{code}")
  @get @behavior("get","Site") @capability("sites.read")
  op getSite(@path code:string): Site | NotFound | Unauthorized | Forbidden;

  @route("/api/sites")
  @get @behavior("listPage","Site") @capability("sites.read")
  op listSites(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): SitePage | BadRequest | Unauthorized | Forbidden;

  @route("/api/sites/{code}")
  @delete @behavior("delete","Site") @capability("sites.write")
  op deleteSite(@path code:string): { @statusCode _: 204; }
    | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/machines")
  @post @behavior("create","Machine") @capability("machines.write")
  op createMachine(@body input: MachineRequest):
    { @statusCode _: 201; @body item: Machine; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/machines/{tag}")
  @get @behavior("get","Machine") @capability("machines.read")
  op getMachine(@path tag:string): Machine | NotFound | Unauthorized | Forbidden;

  @route("/api/machines")
  @get @behavior("listPage","Machine") @capability("machines.read")
  op listMachines(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): MachinePage | BadRequest | Unauthorized | Forbidden;

  @route("/api/machines/{tag}")
  @delete @behavior("delete","Machine") @capability("machines.write")
  op deleteMachine(@path tag:string): { @statusCode _: 204; }
    | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/technicians")
  @post @behavior("create","Technician") @capability("technicians.write")
  op createTechnician(@body input: TechnicianRequest):
    { @statusCode _: 201; @body item: Technician; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/technicians/{badge}")
  @get @behavior("get","Technician") @capability("technicians.read")
  op getTechnician(@path badge:string): Technician | NotFound | Unauthorized | Forbidden;

  @route("/api/technicians")
  @get @behavior("listPage","Technician") @capability("technicians.read")
  op listTechnicians(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): TechnicianPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/technicians/{badge}")
  @delete @behavior("delete","Technician") @capability("technicians.write")
  op deleteTechnician(@path badge:string): { @statusCode _: 204; }
    | NotFound | Conflict | Unauthorized | Forbidden;

  @route("/api/tickets")
  @post @behavior("create","Ticket") @audit("title,status") @capability("tickets.write")
  op createTicket(@body input: TicketRequest):
    { @statusCode _: 201; @body item: Ticket; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/tickets/{number}")
  @get @behavior("get","Ticket") @capability("tickets.read")
  op getTicket(@path number:string): Ticket | NotFound | Unauthorized | Forbidden;

  @route("/api/tickets")
  @get @behavior("listPage","Ticket") @capability("tickets.read")
  op listTickets(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): TicketPage | BadRequest | Unauthorized | Forbidden;

  // A14.2: typed equality and UTC range filters, including one validated FK hop.
  @route("/api/tickets/query/filtered")
  @get @behavior("queryPage","Ticket")
  @queryOrder("dueAt","asc") @capability("tickets.read")
  op searchTickets(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0,
    @query @queryFilter("machineTag.siteCode","eq") siteCode?: string,
    @query @queryFilter("status","eq") status?: string,
    @query @queryFilter("dueAt","gte") dueFrom?: utcDateTime,
    @query @queryFilter("dueAt","lte") dueTo?: utcDateTime
  ): TicketPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/tickets/{number}/plan")
  @post @behavior("transition","Ticket","status") @transition("reported","planned")
  @audit("status") @capability("tickets.write")
  op planTicket(@path number:string):
    Ticket | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/tickets/{number}/complete")
  @post @behavior("transition","Ticket","status") @transition("planned","completed")
  @audit("status") @capability("tickets.write")
  op completeTicket(@path number:string):
    Ticket | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  model TicketReassignment {
    @minLength(1) @maxLength(40) expected: string;
    @minLength(1) @maxLength(40) technicianBadge: string;
  }

  @route("/api/tickets/{number}/technician")
  @patch @behavior("reassignReference","Ticket","technicianBadge","technicianBadge")
  @audit("technicianBadge") @capability("tickets.assign")
  op reassignTicketTechnician(@path number:string,@body input:TicketReassignment):
    Ticket | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

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
  @route("/api/tickets/{number}/audit")
  @get @behavior("auditPage","Ticket") @capability("tickets.audit")
  op ticketHistory(
    @path number:string,
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): AuditPage | NotFound | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health","Site") @capability("public")
  op health(): Health;
}
