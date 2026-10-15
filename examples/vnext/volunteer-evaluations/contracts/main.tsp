import "@typespec/http";
import "@protocolia/domain";
using TypeSpec.Http;
using ProtocolIA.Domain;

// Independent requirements freeze: ACCEPTANCE_FREEZE.md. Fictional data only.
// Unsupported business rules stay explicit in the freeze; never fake computation.
@service(#{ title: "Evaluaciones de voluntariado — ensayo independiente" })
namespace VolunteerEvaluations {
  @entity
  @view("Secciones")
  model Section {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    code: string;
    @minLength(1) @maxLength(120)
    name: string;
  }

  model SectionRequest {
    @minLength(1) @maxLength(40)
    code: string;
    @minLength(1) @maxLength(120)
    name: string;
  }

  model SectionPage {
    items: Section[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity
  @view("Guardias")
  model GuardDuty {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    code: string;
    @reference("Section","restrict") @minLength(1) @maxLength(40)
    sectionCode: string;
    @minLength(1) @maxLength(120)
    name: string;
  }

  model GuardDutyRequest {
    @minLength(1) @maxLength(40)
    code: string;
    @minLength(1) @maxLength(40)
    sectionCode: string;
    @minLength(1) @maxLength(120)
    name: string;
  }

  model GuardDutyPage {
    items: GuardDuty[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity
  @view("Personal")
  model Volunteer {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    badge: string;
    @reference("GuardDuty","restrict") @minLength(1) @maxLength(40)
    guardCode: string;
    @minLength(1) @maxLength(120)
    name: string;
    @minLength(1) @maxLength(80)
    rank: string;
  }

  model VolunteerRequest {
    @minLength(1) @maxLength(40)
    badge: string;
    @minLength(1) @maxLength(40)
    guardCode: string;
    @minLength(1) @maxLength(120)
    name: string;
    @minLength(1) @maxLength(80)
    rank: string;
  }

  model VolunteerPage {
    items: Volunteer[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity
  @view("Calificaciones mensuales")
  model MonthlyEvaluation {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    number: string;
    @reference("Volunteer","restrict") @minLength(1) @maxLength(40)
    volunteerBadge: string;
    @minLength(7) @maxLength(7)
    period: string;
    @minValue(0) @maxValue(25)
    incidentPoints: int32;
    @minValue(0) @maxValue(35)
    mandatoryPoints: int32;
    @minValue(0) @maxValue(20)
    guardPoints: int32;
    @minValue(0) @maxValue(20)
    internalPoints: int32;
    @minValue(0)
    otherPoints: int32;
    @initial("draft") @minLength(1) @maxLength(20)
    status: string;
  }

  model MonthlyEvaluationRequest {
    @minLength(1) @maxLength(40)
    number: string;
    @minLength(1) @maxLength(40)
    volunteerBadge: string;
    @minLength(7) @maxLength(7)
    period: string;
    @minValue(0) @maxValue(25)
    incidentPoints: int32;
    @minValue(0) @maxValue(35)
    mandatoryPoints: int32;
    @minValue(0) @maxValue(20)
    guardPoints: int32;
    @minValue(0) @maxValue(20)
    internalPoints: int32;
    @minValue(0)
    otherPoints: int32;
    @minLength(1) @maxLength(20)
    status: string;
  }

  model MonthlyEvaluationPage {
    items: MonthlyEvaluation[];
    @minValue(1) @maxValue(50) limit: int32;
    @minValue(0) offset: int32;
    @minValue(0) total: int32;
  }

  @entity
  @view("Licencias")
  model LeaveRecord {
    @publicIdentity @unique @minLength(1) @maxLength(40)
    number: string;
    @reference("Volunteer","restrict") @minLength(1) @maxLength(40)
    volunteerBadge: string;
    @minLength(1) @maxLength(30)
    leaveKind: string;
    @minLength(7) @maxLength(7)
    period: string;
    @minValue(1) @maxValue(31)
    days: int32;
    @minLength(1) @maxLength(160)
    notes?: string;
  }

  model LeaveRecordRequest {
    @minLength(1) @maxLength(40)
    number: string;
    @minLength(1) @maxLength(40)
    volunteerBadge: string;
    @minLength(1) @maxLength(30)
    leaveKind: string;
    @minLength(7) @maxLength(7)
    period: string;
    @minValue(1) @maxValue(31)
    days: int32;
    @minLength(1) @maxLength(160)
    notes?: string;
  }

  model LeaveRecordPage {
    items: LeaveRecord[];
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

  @route("/api/sections")
  @post @behavior("create","Section") @capability("sections.write")
  op createSection(@body input: SectionRequest):
    { @statusCode _: 201; @body item: Section; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/sections/{code}")
  @get @behavior("get","Section") @capability("sections.read")
  op getSection(@path code:string): Section | NotFound | Unauthorized | Forbidden;

  @route("/api/sections")
  @get @behavior("listPage","Section") @capability("sections.read")
  op listSection(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): SectionPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/guards")
  @post @behavior("create","GuardDuty") @capability("guards.write")
  op createGuardDuty(@body input: GuardDutyRequest):
    { @statusCode _: 201; @body item: GuardDuty; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/guards/{code}")
  @get @behavior("get","GuardDuty") @capability("guards.read")
  op getGuardDuty(@path code:string): GuardDuty | NotFound | Unauthorized | Forbidden;

  @route("/api/guards")
  @get @behavior("listPage","GuardDuty") @capability("guards.read")
  op listGuardDuty(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): GuardDutyPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/volunteers")
  @post @behavior("create","Volunteer") @capability("volunteers.write")
  op createVolunteer(@body input: VolunteerRequest):
    { @statusCode _: 201; @body item: Volunteer; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/volunteers/{badge}")
  @get @behavior("get","Volunteer") @capability("volunteers.read")
  op getVolunteer(@path badge:string): Volunteer | NotFound | Unauthorized | Forbidden;

  @route("/api/volunteers")
  @get @behavior("listPage","Volunteer") @capability("volunteers.read")
  op listVolunteer(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): VolunteerPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/monthly-evaluations")
  @post @behavior("create","MonthlyEvaluation") @audit("incidentPoints,mandatoryPoints,guardPoints,internalPoints,otherPoints,status") @capability("evaluations.write")
  op createMonthlyEvaluation(@body input: MonthlyEvaluationRequest):
    { @statusCode _: 201; @body item: MonthlyEvaluation; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/monthly-evaluations/{number}")
  @get @behavior("get","MonthlyEvaluation") @capability("evaluations.read")
  op getMonthlyEvaluation(@path number:string): MonthlyEvaluation | NotFound | Unauthorized | Forbidden;

  @route("/api/monthly-evaluations")
  @get @behavior("listPage","MonthlyEvaluation") @capability("evaluations.read")
  op listMonthlyEvaluation(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): MonthlyEvaluationPage | BadRequest | Unauthorized | Forbidden;

  @route("/api/leave-records")
  @post @behavior("create","LeaveRecord") @capability("leave.write")
  op createLeaveRecord(@body input: LeaveRecordRequest):
    { @statusCode _: 201; @body item: LeaveRecord; }
    | Conflict | BadRequest | Unauthorized | Forbidden;

  @route("/api/leave-records/{number}")
  @get @behavior("get","LeaveRecord") @capability("leave.read")
  op getLeaveRecord(@path number:string): LeaveRecord | NotFound | Unauthorized | Forbidden;

  @route("/api/leave-records")
  @get @behavior("listPage","LeaveRecord") @capability("leave.read")
  op listLeaveRecord(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): LeaveRecordPage | BadRequest | Unauthorized | Forbidden;

  // Monthly consultation by person/period; total points is NOT generated.
  @route("/api/monthly-evaluations/query/filtered")
  @get @behavior("queryPage","MonthlyEvaluation")
  @queryOrder("period","desc") @capability("evaluations.read")
  op queryMonthlyEvaluations(
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0,
    @query @queryFilter("volunteerBadge","eq") volunteerBadge?: string,
    @query @queryFilter("period","eq") period?: string
  ): MonthlyEvaluationPage | BadRequest | Unauthorized | Forbidden;

  // A guard reassignment is a protected, compare-and-swap FK change with audit.
  model GuardReassignment {
    @minLength(1) @maxLength(40) expected: string;
    @minLength(1) @maxLength(40) guardCode: string;
  }
  @route("/api/volunteers/{badge}/guard")
  @patch @behavior("reassignReference","Volunteer","guardCode","guardCode")
  @audit("guardCode") @capability("volunteers.assign")
  op changeVolunteerGuard(@path badge: string, @body input: GuardReassignment):
    Volunteer | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

  // Publication does not pretend to calculate composite scores or licenses.
  @route("/api/monthly-evaluations/{number}/close")
  @post @behavior("transition","MonthlyEvaluation","status")
  @transition("draft","closed") @audit("status") @capability("evaluations.write")
  op closeMonthlyEvaluation(@path number: string):
    MonthlyEvaluation | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;

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
  @route("/api/monthly-evaluations/{number}/audit")
  @get @behavior("auditPage","MonthlyEvaluation") @capability("evaluations.audit")
  op evaluationAudit(
    @path number: string,
    @query @minValue(1) @maxValue(50) limit?: int32 = 25,
    @query @minValue(0) @maxValue(1000000) offset?: int32 = 0
  ): AuditPage | NotFound | BadRequest | Unauthorized | Forbidden;

  @route("/health")
  @get @behavior("health","Section") @capability("public")
  op health(): Health;
}
