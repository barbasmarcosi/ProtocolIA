package dev.protocolia.modular;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLDecoder;
import java.sql.SQLException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.core.Authentication;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class DomainRuntime {
  private final NamedParameterJdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate providerIngressJdbc;
  public DomainRuntime(NamedParameterJdbcTemplate jdbc) {
    this.jdbc=jdbc;
    String user=System.getenv().getOrDefault("PROTOCOLIA_PROVIDER_INGRESS_JDBC_USER","");
    String password=System.getenv().getOrDefault("PROTOCOLIA_PROVIDER_INGRESS_JDBC_PASSWORD","");
    if(user.isEmpty()!=password.isEmpty())
      throw new IllegalStateException("Provider ingress requires both DB user and password");
    if(user.isEmpty()) {
      this.providerIngressJdbc=jdbc; // Legacy sandbox mode, never bank authority.
      return;
    }
    String runtimeUser=System.getenv().getOrDefault("PROTOCOLIA_JDBC_USER","");
    String migrationUser=System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_USER","");
    String url=System.getenv().getOrDefault("PROTOCOLIA_JDBC_URL","");
    if(!Manifest.PROVIDER_INBOX_ENABLED||
       !"true".equals(System.getenv("PROTOCOLIA_PROVIDER_SANDBOX_ENABLED"))||
       !"demo".equals(System.getenv("PROTOCOLIA_AUTH_MODE"))||
       "migrate".equals(System.getenv("PROTOCOLIA_EXECUTION_MODE"))||
       user.equals(runtimeUser)||user.equals(migrationUser)||
       password.length()<16||!url.startsWith("jdbc:postgresql://"))
      throw new IllegalStateException("Unsafe or unsupported provider ingress SQL identity");
    // Dedicated unpooled connections: no application transaction, migration,
    // session or other domain handler can accidentally borrow this identity.
    var isolated=new NamedParameterJdbcTemplate(
      new DriverManagerDataSource(url,user,password));
    String principal=isolated.queryForObject("SELECT current_user",Map.of(),String.class);
    Boolean superuser=isolated.queryForObject(
      "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",Map.of(),Boolean.class);
    Boolean writer=isolated.queryForObject(
      "SELECT has_function_privilege(current_user,"+
      "'public.protocolia_record_provider_envelope_digest(text,text,text)','EXECUTE')",
      Map.of(),Boolean.class);
    Boolean reader=isolated.queryForObject(
      "SELECT has_function_privilege(current_user,"+
      "'public.protocolia_provider_receipt_integrity_projection(text)','EXECUTE')",
      Map.of(),Boolean.class);
    Boolean directInsert=isolated.queryForObject(
      "SELECT has_table_privilege(current_user,"+
      "'public.protocolia_provider_envelope_inbox','INSERT')",Map.of(),Boolean.class);
    Boolean ordinaryWriter=jdbc.queryForObject(
      "SELECT has_function_privilege(current_user,"+
      "'public.protocolia_record_provider_envelope_digest(text,text,text)','EXECUTE')",
      Map.of(),Boolean.class);
    if(!user.equals(principal)||!Boolean.FALSE.equals(superuser)||
       !Boolean.TRUE.equals(writer)||!Boolean.FALSE.equals(reader)||
       !Boolean.FALSE.equals(directInsert)||!Boolean.FALSE.equals(ordinaryWriter))
      throw new IllegalStateException(
        "Provider ingress DB privileges do not match the reviewed split");
    this.providerIngressJdbc=isolated;
    System.out.println("PROTOCOLIA_SPRING_PROVIDER_INGRESS_PRINCIPAL_READY");
  }

  private static final class InvalidInputField extends ResponseStatusException {
    final String field;
    final String code;
    InvalidInputField(String field,String code) {
      super(HttpStatus.BAD_REQUEST,"Validation failed");
      this.field=field;this.code=code;
    }
  }
  @ExceptionHandler(InvalidInputField.class)
  public ResponseEntity<Map<String,Object>> handleInvalidInputField(InvalidInputField error) {
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
      "statusCode",400,"message","Validation failed",
      "issues",List.of(Map.of("field",error.field,"code",error.code))));
  }

  // Opt-in worker. Failed ticks are retried in later polls using durable rows.
  @Scheduled(fixedDelayString="${PROTOCOLIA_ALERT_INTERVAL_MS:60000}",
             initialDelayString="${PROTOCOLIA_ALERT_INITIAL_DELAY_MS:2000}")
  public void tickOverdueInbox() {
    if(!Manifest.HAS_OVERDUE_RULES ||
        !"true".equals(System.getenv("PROTOCOLIA_ALERT_WORKER_ENABLED"))) return;
    try {
      var result=jdbc.queryForMap(
        "SELECT enqueued,dispatched FROM protocolia_tick_notifications(:asOf,:batch)",
        Map.of("asOf",OffsetDateTime.now(),"batch",25));
      System.out.println("PROTOCOLIA_ALERT_TICK "+result);
    } catch(RuntimeException error) {
      System.err.println("PROTOCOLIA_ALERT_TICK_FAILED "+error.getClass().getSimpleName());
    }
  }

  @GetMapping("/api/_protocolia/auth/config")
  public Map<String,Object> browserAuth(){return SecurityConfig.bffEnabled()?Map.of("mode","bff","enabled",true):SecurityConfig.browserAuthConfig();}

  @GetMapping("/health")
  public Map<String, String> health() { return Map.of("status", "UP"); }

  // Deliberately demo-only. This records authenticated envelope digests, not money.
  @PostMapping("/api/_protocolia/provider/sandbox/inbox")
  public ResponseEntity<Map<String,String>> receiveSandboxProvider(
      HttpServletRequest request) throws java.io.IOException {
    return processSandboxProvider(request,0);
  }

  @PostMapping("/api/_protocolia/provider/sandbox/receipt-candidate")
  public ResponseEntity<Map<String,String>> receiveSandboxReceiptCandidate(
      HttpServletRequest request) throws java.io.IOException {
    return processSandboxProvider(request,1);
  }

  @PostMapping("/api/_protocolia/provider/sandbox/lifecycle-observation")
  public ResponseEntity<Map<String,String>> receiveSandboxLifecycle(
      HttpServletRequest request) throws java.io.IOException {
    return processSandboxProvider(request,2);
  }

  private ResponseEntity<Map<String,String>> processSandboxProvider(
      HttpServletRequest request,int mode) throws java.io.IOException {
    if(!Manifest.PROVIDER_INBOX_ENABLED||!"true".equals(System.getenv("PROTOCOLIA_PROVIDER_SANDBOX_ENABLED")))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Sandbox ingress disabled");
    if(!"demo".equals(System.getenv("PROTOCOLIA_AUTH_MODE")))
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Sandbox forbidden outside demo");
    var keys=ProviderWebhookVerifier.parseSandboxKeys(
      System.getenv("PROTOCOLIA_PROVIDER_SANDBOX_KEY_HEX"),
      System.getenv("PROTOCOLIA_PROVIDER_SANDBOX_KEYS"));
    if(keys==null)
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Sandbox keys unavailable");
    // Avoid @RequestBody byte[]: MVC would materialize an unbounded untrusted
    // body before the 64 KiB application check. Bound Content-Length and
    // chunked/unknown-length streams before authentication or SQL.
    if(!"application/json".equals(request.getContentType())||
       request.getContentLengthLong()>65536)
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid raw provider body");
    byte[] rawBody=request.getInputStream().readNBytes(65537);
    if(rawBody.length<1||rawBody.length>65536)
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid raw provider body");
    String[] names={"X-ProtocolIA-Key-Id","X-ProtocolIA-Timestamp",
      "X-ProtocolIA-Event-Id","X-ProtocolIA-Signature"};
    for(String name:names){
      var values=java.util.Collections.list(request.getHeaders(name));
      if(values.size()!=1)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Missing or duplicate provider header");
    }
    var verified=ProviderWebhookVerifier.verify(
      mode==1?"receipt-candidate":mode==2?"lifecycle-observation":"inbox",
      request.getHeader(names[0]),request.getHeader(names[1]),
      request.getHeader(names[2]),request.getHeader(names[3]),rawBody,
      keys,
      java.time.Instant.now().getEpochSecond());
    if(verified==null)
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid provider signature");
    String outcome;
    try{
      String query="SELECT protocolia_record_provider_envelope_digest(:provider,:event,:digest)";
      var args=new MapSqlParameterSource().addValue("provider","sandbox_provider")
        .addValue("event",verified.eventId()).addValue("digest",verified.payloadSha256());
      if(mode==1){
        // Strict canonical signed ASCII JSON prevents duplicate keys and ambiguous claims.
        String raw=new String(rawBody,StandardCharsets.UTF_8);
        var matcher=Pattern.compile(
          "\\{\\\"version\\\":\\\"receipt-candidate\\.v1\\\",\\\"receiptId\\\":\\\"([A-Za-z0-9_-]{1,128})\\\",\\\"orderId\\\":\\\"([A-Za-z0-9_-]{1,128})\\\",\\\"amount\\\":\\\"((?:0|[1-9][0-9]{0,11})\\.[0-9]{2})\\\"\\}"
        ).matcher(raw);
        if(!matcher.matches()||"0.00".equals(matcher.group(3)))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid canonical receipt candidate");
        query="SELECT protocolia_record_provider_receipt_candidate("+
          ":provider,:event,:digest,:receipt,:orderId,CAST(:amount AS NUMERIC))";
        args.addValue("receipt",matcher.group(1)).addValue("orderId",matcher.group(2))
          .addValue("amount",matcher.group(3));
      }
      if(mode==2){
        // Exact signed canonical ASCII JSON; no duplicate or injected keys.
        // Reported phases are observations, not verified bank settlement.
        String raw=new String(rawBody,StandardCharsets.UTF_8);
        var matcher=Pattern.compile("\\{\"version\":\"lifecycle-observation\\.v1\",\"candidateEventId\":\"([A-Za-z0-9_-]{8,128})\",\"receiptId\":\"([A-Za-z0-9_-]{1,128})\",\"orderId\":\"([A-Za-z0-9_-]{1,128})\",\"amount\":\"((?:0|[1-9][0-9]{0,11})\\.[0-9]{2})\",\"sequence\":\"([1-9][0-9]{0,9})\",\"phase\":\"(reported_pending|reported_success|reported_failure|reported_reversal)\"\\}").matcher(raw);
        if(!matcher.matches()||"0.00".equals(matcher.group(4)))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid canonical lifecycle observation");
        query="SELECT protocolia_record_provider_lifecycle_observation("+
          ":provider,:event,:digest,:candidate,:receipt,:orderId,"+
          "CAST(:amount AS NUMERIC),CAST(:sequence AS NUMERIC),:phase)";
        args.addValue("candidate",matcher.group(1)).addValue("receipt",matcher.group(2))
          .addValue("orderId",matcher.group(3)).addValue("amount",matcher.group(4))
          .addValue("sequence",matcher.group(5)).addValue("phase",matcher.group(6));
      }
      outcome=providerIngressJdbc.queryForObject(query,args,String.class);
    }catch(DataAccessException error){
      if(constraintSqlState(error,"40001"))
        throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Retry provider inbox",error);
      if(constraintSqlState(error,"23514")||constraintSqlState(error,"22003"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid receipt candidate",error);
      throw error;
    }
    HttpStatus status=switch(outcome){
      case "stored" -> HttpStatus.ACCEPTED;
      case "duplicate" -> HttpStatus.OK;
      case "conflict","mismatch" -> HttpStatus.CONFLICT;
      case "missing" -> HttpStatus.NOT_FOUND;
      default -> throw new IllegalStateException("Unexpected provider inbox outcome");
    };
    return ResponseEntity.status(status).header("Cache-Control","no-store")
      .body(Map.of("outcome",outcome));
  }

  // Platform-authenticated capability discovery; only server authorities are trusted.
  @GetMapping("/api/_protocolia/me")
  public Map<String, Object> session(Authentication user,HttpServletRequest request) {
    if (user == null || !user.isAuthenticated())
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    SecurityConfig.verifyOidcIdentity(request,user);
    var declared=java.util.stream.Stream.of(Manifest.READ_CAPABILITIES,
        Manifest.WRITE_CAPABILITIES,Manifest.AUDIT_CAPABILITIES,
        Manifest.ASSIGN_CAPABILITIES,Manifest.FIELD_READ_CAPABILITIES)
        .flatMap(java.util.List::stream).collect(java.util.stream.Collectors.toSet());
    return Map.of("username",user.getName(),
      "capabilities",user.getAuthorities().stream().map(a->a.getAuthority())
        .filter(declared::contains).distinct().sorted().toList());
  }

  @Transactional
  @RequestMapping("/api/**")
  public ResponseEntity<Object> dispatch(
      HttpServletRequest request,
      @RequestBody(required = false) Map<String, Object> body,
      @RequestParam Map<String, String> query,
      Authentication user) {
    Manifest.Op matched = null;
    String publicKey = null;
    String adjustmentKey = null;
    for (var op : Manifest.OPS) {
      if (!op.method().equals(request.getMethod())) continue;
      String pattern = op.path().replaceAll("\\{[A-Za-z][A-Za-z0-9_]*\\}", "([^/]+)");
      Matcher matcher = Pattern.compile("^" + pattern + "$").matcher(request.getRequestURI());
      if (matcher.matches()) {
        matched = op;
        if (matcher.groupCount() > 0) publicKey = URLDecoder.decode(matcher.group(1), StandardCharsets.UTF_8);
        if (matched.kind().equals("lookupExactAdjustment") && matcher.groupCount() == 2)
          adjustmentKey = URLDecoder.decode(matcher.group(2), StandardCharsets.UTF_8);
        break;
      }
    }
    if (matched == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    Manifest.Op authorized = matched;
    if (!authorized.capability().equals("public") &&
        (user == null || user.getAuthorities().stream().noneMatch(a -> a.getAuthority().equals(authorized.capability())))) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    if (matched.exactReverse()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.exactReverse().parentWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.exactDebit()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.exactDebit().parentWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.reserve()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.reserve().stockWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.moveUnits()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.moveUnits().parentWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.moveBatch()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.moveBatch().parentWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.createDetails()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.createDetails().childWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.reverseBatch()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.reverseBatch().parentWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.reverseUnits()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.reverseUnits().parentWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.kind().equals("reconcileExact")) {
      var plan=Manifest.EXACT_RECONCILIATIONS.get(matched.name());
      if(plan==null || user==null || user.getAuthorities().stream().noneMatch(a ->
          a.getAuthority().equals(plan.childReadCapability())))
        throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    if (matched.kind().equals("sumDetails")) {
      var plan=Manifest.DETAIL_SUMS.get(matched.name());
      if(plan==null || user==null || user.getAuthorities().stream().noneMatch(a ->
          a.getAuthority().equals(plan.childReadCapability())))
        throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    if (matched.kind().equals("sumRelated")) {
      var plan=Manifest.RELATED_SUMS.get(matched.name());
      if(plan==null || user==null || user.getAuthorities().stream().noneMatch(a ->
          a.getAuthority().equals(plan.childReadCapability())))
        throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    if (matched.release()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.release().stockWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    Manifest.Entity entity = Manifest.ENTITIES.stream().filter(e -> e.name().equals(authorized.entity())).findFirst()
        .orElseThrow(() -> new IllegalStateException("Unresolved entity in generated manifest"));
    Object result;
    switch (matched.kind()) {
      case "create" -> result = create(entity, matched, body, user,request.getHeader("If-Match"),false);
      case "get" -> result = row(entity, publicKey, user.getName());
      case "sumRelated" -> result = sumRelated(matched,publicKey);
      case "sumDetails" -> result = sumDetails(matched,publicKey);
      case "reconcileExact" -> result = reconcileExact(matched,publicKey);
      case "adjustExact" -> result = adjustExact(entity,publicKey,body,user);
      case "lookupExactAdjustment" -> result = lookupExactAdjustment(entity,publicKey,adjustmentKey,user.getName());
      case "listPage" -> result = page(entity, query, matched, user.getName());
      case "queryPage" -> result = queryPage(entity, query, matched);
      case "inboxPage", "ackNotification" -> result = inbox(entity, matched, publicKey, query, body, user, request);
      case "auditPage" -> result = auditPage(entity, publicKey, query, matched);
      case "patchFields" -> result = patch(entity, matched, publicKey, body, user.getName(),request.getHeader("If-Match"));
      case "replaceDetails" -> result = replaceDetails(entity, matched, publicKey, body,
        user,request.getHeader("If-Match"));
      case "patchTogether" -> result = patchTogether(entity, matched, publicKey, body, user.getName());
      case "atomicIncrement" -> result = increment(entity, matched, publicKey, body);
      case "transition" -> result = transition(entity, matched, publicKey, body,
        request.getHeader("If-Match"));
      case "reassignReference" -> result = reassignReference(entity, matched, publicKey, body);
      case "delete" -> result = delete(entity, matched, publicKey, user,
        request.getHeader("If-Match"),body);
      default -> throw new IllegalStateException("Unsupported generated behavior");
    }
    if(!matched.audit().isEmpty()&&!matched.kind().equals("delete")){
      if(user==null || !user.isAuthenticated())
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
      @SuppressWarnings("unchecked")
      var updated=(Map<String,Object>)result;
      String id=String.valueOf(updated.get(entity.identity()));
      for(String field:matched.audit()){
        Object after=updated.get(field);
        String before=matched.kind().equals("transition")?matched.fromState():
            Set.of("reassignReference","patchFields").contains(matched.kind())?
              String.valueOf(body.get("expected")):null;
        jdbc.update("INSERT INTO protocolia_audit_event "+
          "(actor,entity_name,resource_id,operation_name,field_name,before_value,after_value) "+
          "VALUES (:actor,:entity,:id,:op,:field,:before,:after)",
          new MapSqlParameterSource().addValue("actor",user.getName())
          .addValue("entity",entity.name()).addValue("id",id)
          .addValue("op",matched.name()).addValue("field",field)
          .addValue("before",before).addValue("after",after==null?null:String.valueOf(after)));
      }
    }
    var sensitive=entity.fields().stream().filter(f->f.readCapability()!=null&&
      (user==null||user.getAuthorities().stream().noneMatch(a->a.getAuthority().equals(f.readCapability()))))
      .map(Manifest.Field::name).toList();
    if(!sensitive.isEmpty()&&result instanceof Map<?,?> raw){
      if(matched.kind().equals("listPage")){
        var page=new LinkedHashMap<String,Object>();
        raw.forEach((key,val)->page.put(String.valueOf(key),val));
        var entries=(List<?>)page.get("items");
        page.put("items",entries.stream().map(item->{
          var record=new LinkedHashMap<String,Object>();
          ((Map<?,?>)item).forEach((key,val)->record.put(String.valueOf(key),val));
          sensitive.forEach(record::remove);
          return record;
        }).toList());
        result=page;
      }else if(Set.of("create","adjustExact","get","patchFields","patchTogether").contains(matched.kind())){
        var record=new LinkedHashMap<String,Object>();
        raw.forEach((key,val)->record.put(String.valueOf(key),val));
        sensitive.forEach(record::remove);
        result=record;
      }
    }
    int status = Set.of("create","adjustExact").contains(matched.kind()) ? 201 : matched.kind().equals("delete") ? 204 : 200;
    var response=ResponseEntity.status(status);
    if(matched.kind().equals("lookupExactAdjustment"))response.header("Cache-Control","no-store");
    if(result instanceof Map<?,?> v && v.get("documentVersion") instanceof Number number)
      response.header("ETag","\""+number.intValue()+"\"");
    return response.body(result);
  }

  private Object inbox(Manifest.Entity entity,Manifest.Op op,String id,Map<String,String> query,
      Map<String,Object> body,Authentication user,HttpServletRequest request) {
    if(user==null||!user.isAuthenticated())throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    boolean read=op.kind().equals("inboxPage");
    if(body!=null||query.keySet().stream().anyMatch(k->!read||!Set.of("limit","offset").contains(k))||
        request.getParameterMap().values().stream().anyMatch(values->values.length!=1))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var args=new MapSqlParameterSource().addValue("issuer","demo-basic").addValue("subject",user.getName());
    String suffix;
    if(read){
      int limit,offset;
      try{
        String l=query.getOrDefault("limit","25"),o=query.getOrDefault("offset","0");
        if(!l.matches("[0-9]+")||!o.matches("[0-9]+"))throw new NumberFormatException();
        limit=Integer.parseInt(l);offset=Integer.parseInt(o);
      }catch(NumberFormatException ex){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
      if(limit<1||limit>50||offset<0||offset>1000000)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
      args.addValue("limit",limit).addValue("offset",offset);
      suffix="_page(:issuer,:subject,:limit,:offset)";
    }else{
      try{
        if(id==null||!id.matches("[1-9][0-9]{0,18}"))throw new NumberFormatException();
        args.addValue("id",Long.parseLong(id));
      }catch(NumberFormatException ex){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
      suffix="_ack(:issuer,:subject,:id)";
    }
    try{
      String json=jdbc.queryForObject("SELECT protocolia_inbox_"+entity.table()+suffix+"::text",args,String.class);
      return new tools.jackson.databind.json.JsonMapper().readValue(json,Map.class);
    }catch(org.springframework.dao.DataAccessException ex){
      if(constraintSqlState(ex,"42501"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
      if(constraintSqlState(ex,"P0002"))throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      if(constraintSqlState(ex,"22023"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
      throw ex;
    }
  }

  private String selectSql(Manifest.Entity e) {
    String columns = e.fields().stream().map(f -> f.column() + " AS \"" + f.name() + "\"")
        .reduce((a,b) -> a + "," + b).orElseThrow();
    if(Manifest.OPS.stream().anyMatch(op->op.entity().equals(e.name())&&
        op.createDetails()!=null&&op.createDetails().versioned()))
      columns+=",document_version AS \"documentVersion\"";
    return "SELECT " + columns + " FROM " + e.table();
  }

  private Map<String,Object> serialized(Map<String,Object> original, Manifest.Entity e) {
    Map<String,Object> converted = new LinkedHashMap<>(original);
    for (var f : e.fields()) {
      Object value = converted.get(f.name());
      if (f.type().equals("decimal") && value instanceof BigDecimal bd) converted.put(f.name(), bd.toPlainString());
      else if (f.type().equals("utcDateTime") && value instanceof Timestamp ts) converted.put(f.name(), ts.toInstant().toString());
      else if (f.type().equals("utcDateTime") && value instanceof OffsetDateTime odt) converted.put(f.name(), odt.toInstant().toString());
    }
    return converted;
  }

  // Serialize exact-ledger writes on the balance parent, THEN read the
  // journal in a separate READ COMMITTED statement after the lock. A stale
  // statement-level subquery cannot validate a concurrent committed receipt.
  private void requireConsistentExactLedger(String table,String balanceKey,String id){
    var parent=Manifest.ENTITIES.stream().filter(e->e.table().equals(table))
      .findFirst().orElse(null);
    if(parent==null)return;
    var plan=Manifest.EXACT_RECONCILIATIONS.values().stream()
      .filter(x->x.parentEntity().equals(parent.name())).findFirst().orElse(null);
    if(plan==null)return; // Legacy standalone exact debit/reverse unchanged.
    var lock=jdbc.queryForList("SELECT "+balanceKey+" FROM "+table+
      " WHERE "+balanceKey+"=:identity FOR UPDATE",Map.of("identity",id),String.class);
    if(lock.size()!=1)
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Balance resource not found");
    var snapshot=jdbc.queryForList(plan.sql(),Map.of("identity",id));
    if(snapshot.size()!=1||!Boolean.TRUE.equals(snapshot.get(0).get("balanced")))
      throw new ResponseStatusException(HttpStatus.CONFLICT,"Exact ledger reconciliation conflict");
  }
  // S2c-1b1: independent capability is checked by dispatch; the common
  // PostgreSQL function serializes parent, revalidates the ledger and inserts
  // one immutable signed correction + exact balances + audit atomically.
  private Map<String,Object> adjustExact(Manifest.Entity e,String id,
      Map<String,Object> body,Authentication actor) {
    var plan=Manifest.EXACT_RECONCILIATIONS.values().stream()
      .filter(x->x.parentEntity().equals(e.name())).findFirst().orElse(null);
    if(id==null||plan==null||body==null||body.size()!=8||
        !body.keySet().equals(Set.of("adjustmentId","delta","reason",
          "expectedOpening","expectedAvailable","expectedPostingCount",
          "expectedReversedTotal","expectedAdjustmentCount")))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid exact adjustment request");
    var field=e.fields().stream()
      .filter(f->plan.chargeSources().contains(f.name())).findFirst().orElse(null);
    if(field==null||field.scale()==null||field.precision()==null||
      field.decimalMax()==null||!(body.get("adjustmentId") instanceof String aid)||
      aid.length()<8||aid.length()>64||aid.isBlank()||
      !(body.get("reason") instanceof String reason)||
      reason.trim().length()<12||reason.trim().length()>240||
      !(body.get("delta") instanceof String raw)||
      !raw.matches("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?"))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid signed adjustment payload");
    BigDecimal delta,max;
    try{
      delta=new BigDecimal(raw).setScale(field.scale(),java.math.RoundingMode.UNNECESSARY);
      max=new BigDecimal(field.decimalMax());
    }catch(ArithmeticException|NumberFormatException ex){
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid exact decimal precision");
    }
    if(delta.signum()==0||delta.abs().compareTo(max)>0||
      raw.replaceFirst("^-","").split("\\.")[0].replaceFirst("^0+","").length()>
        field.precision()-field.scale())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Adjustment out of range");
    var reviewed=new java.util.HashMap<String,BigDecimal>();
    for(String name:List.of("expectedOpening","expectedAvailable","expectedReversedTotal")){
      if(!(body.get(name) instanceof String value)||
          !value.matches("(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid reviewed money");
      String[] parts=value.split("\\.",-1);
      if(parts[0].replaceFirst("^0+","").length()>field.precision()-field.scale()||
          parts.length==2&&parts[1].length()>field.scale())
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid reviewed precision");
      try{
        BigDecimal amount=new BigDecimal(value).setScale(field.scale(),java.math.RoundingMode.UNNECESSARY);
        if(amount.compareTo(max)>0)
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Reviewed amount out of range");
        reviewed.put(name,amount);
      }catch(ArithmeticException|NumberFormatException ex){
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid reviewed decimal",ex);
      }
    }
    var counts=new java.util.HashMap<String,Long>();
    for(String name:List.of("expectedPostingCount","expectedAdjustmentCount")){
      if(!(body.get(name) instanceof String value)||
          value.length()>(name.equals("expectedPostingCount")?16:3)||
          !value.matches("(?:0|[1-9][0-9]*)"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid reviewed count");
      long count=Long.parseLong(value);
      if(name.equals("expectedAdjustmentCount")&&count>100)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid adjustment count");
      counts.put(name,count);
    }
    var args=new MapSqlParameterSource().addValue("identity",id)
      .addValue("adj",aid).addValue("delta",delta)
      .addValue("reason",reason).addValue("actor",actor.getName())
      .addValue("expectedOpen",reviewed.get("expectedOpening"))
      .addValue("expectedAvailable",reviewed.get("expectedAvailable"))
      .addValue("expectedPosting",counts.get("expectedPostingCount"))
      .addValue("expectedReversed",reviewed.get("expectedReversedTotal"))
      .addValue("expectedAdjustments",counts.get("expectedAdjustmentCount"));
    try{
      jdbc.queryForList("SELECT protocolia_apply_exact_adjustment_"+e.table()+
        "(:identity,:adj,:delta,:reason,:actor,:expectedOpen,:expectedAvailable,"+
        ":expectedPosting,:expectedReversed,:expectedAdjustments)",args);
    }catch(DataAccessException ex){
      if(constraintSqlState(ex,"PZ409")||constraintSqlState(ex,"23505"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Exact adjustment conflict",ex);
      if(constraintSqlState(ex,"P0002"))
        throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Work order not found",ex);
      if(constraintSqlState(ex,"23514")||constraintSqlState(ex,"22003"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid exact adjustment",ex);
      throw ex;
    }
    return row(e,id,actor.getName());
  }
  private Map<String,Object> lookupExactAdjustment(Manifest.Entity e,String id,String adjustmentId,String actor){
    var plan=Manifest.EXACT_RECONCILIATIONS.values().stream()
      .filter(x->x.parentEntity().equals(e.name())).findFirst().orElse(null);
    if(plan==null||id==null||adjustmentId==null||adjustmentId.length()<8||
      adjustmentId.length()>64||adjustmentId.isBlank())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid exact adjustment lookup identity");
    var rows=jdbc.queryForList("SELECT adjustment_id AS \"adjustmentId\","+
      "delta::text AS \"delta\",reason,'committed'::text AS \"status\" FROM "+
      "protocolia_exact_adjustment_"+e.table()+
      " WHERE parent_id=:identity AND adjustment_id=:adjustmentId AND actor=:actor",
      Map.of("identity",id,"adjustmentId",adjustmentId,"actor",actor));
    if(rows.size()!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND,
      "Committed adjustment not found for order");
    return rows.get(0);
  }
  private Map<String,Object> reconcileExact(Manifest.Op op,String id){
    if(id==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var plan=Manifest.EXACT_RECONCILIATIONS.get(op.name());
    if(plan==null)throw new IllegalStateException("Missing exact reconciliation plan");
    var result=jdbc.queryForList(plan.sql(),Map.of("identity",id));
    if(result.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return result.get(0);
  }

  private Map<String,Object> sumDetails(Manifest.Op op,String id){
    if(id==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var plan=Manifest.DETAIL_SUMS.get(op.name());
    if(plan==null)throw new IllegalStateException("Missing full detail sum");
    var rows=jdbc.queryForList(plan.sql(),Map.of("identity",id));
    if(rows.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return Map.of("totalUnits",String.valueOf(rows.get(0).get("totalUnits")));
  }

  private Map<String,Object> sumRelated(Manifest.Op op,String id){
    if(id==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var plan=Manifest.RELATED_SUMS.get(op.name());
    if(plan==null)throw new IllegalStateException("Missing authorized aggregate plan");
    // Single MVCC snapshot of parent and all active related records.
    var result=jdbc.queryForList(plan.sql(),Map.of("identity",id));
    if(result.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return Map.of("totalUnits",String.valueOf(result.get(0).get("totalUnits")));
  }

  private Map<String,Object> row(Manifest.Entity e, String id) {
    return row(e,id,null);
  }
  private Map<String,Object> row(Manifest.Entity e, String id, String subject) {
    if (id == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    if(e.ownerField()!=null && subject==null)throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    try {
      String condition=e.ownerField()==null?"":" AND "+e.ownerColumn()+"=:owner";
      var args=new MapSqlParameterSource().addValue("key",id);
      if(e.ownerField()!=null)args.addValue("owner",subject);
      return serialized(jdbc.queryForMap(
          selectSql(e) + " WHERE " + e.identityColumn() + " = :key"+condition,
          args), e);
    } catch (EmptyResultDataAccessException ex) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
  }

  private void validate(Manifest.Entity e, Map<String,Object> body, boolean create, Set<String> writable) {
    if (body == null || !writable.containsAll(body.keySet())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown input property");
    if (create) {
      for (var f : e.fields()) if (f.required() && !f.computed() && !body.containsKey(f.name()) && f.initial()==null)
        throw new InvalidInputField(f.name(),"required");
    }
    if (create) for (var f : e.fields()) {
      if (f.requiredSource() == null || !f.requiredValue().equals(body.get(f.requiredSource()))) continue;
      Object candidate=body.get(f.name());
      if (!(candidate instanceof String text) || text.isBlank())
        throw new InvalidInputField(f.name(),"required");
    }
    if(create)for(var f:e.fields()){
      if(f.forbidSource()!=null&&f.forbidValue().equals(body.get(f.forbidSource()))&&body.containsKey(f.name()))
        throw new InvalidInputField(f.name(),"invalid_combination");
    }
    for (var input : body.entrySet()) {
      var f = e.fields().stream().filter(x -> x.name().equals(input.getKey())).findFirst()
          .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown field"));
      Object v = input.getValue();
      if (create && f.initial() != null && !f.initial().equals(v))
        throw new InvalidInputField(f.name(),"invalid_initial");
      if (v == null) {
        if (!f.nullable()) throw new InvalidInputField(f.name(),"required");
        continue;
      }
      if (f.type().equals("string")) {
        if (!(v instanceof String s) || s.isBlank() ||
            (f.minLength()!=null && s.length() < f.minLength()) ||
            (f.maxLength()!=null && s.length() > f.maxLength()) ||
             (f.pattern()!=null && !Pattern.matches(f.pattern(),s)))
          throw new InvalidInputField(f.name(),v instanceof String?"invalid_format":"invalid_type");
        if (!f.choices().isEmpty() && !f.choices().contains(v))
          throw new InvalidInputField(f.name(),"invalid_choice");
      } else if (f.type().equals("int32")) {
        if (!(v instanceof Integer n) || (f.min()!=null && n < f.min()) || (f.max()!=null && n > f.max()))
          throw new InvalidInputField(f.name(),v instanceof Integer?"out_of_range":"invalid_type");
      } else if (f.type().equals("decimal")) {
        if (!(v instanceof String s))throw new InvalidInputField(f.name(),"invalid_type");
        if (s.length() > f.precision()+f.scale()+4 ||
            !Pattern.matches("^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$",s))
          throw new InvalidInputField(f.name(),"invalid_format");
        String positive=s.startsWith("-")?s.substring(1):s;
        int dot=positive.indexOf('.');
        String integerPart=dot<0?positive:positive.substring(0,dot);
        int fractionalDigits=dot<0?0:positive.length()-dot-1;
        if(integerPart.replaceFirst("^0+","").length()>f.precision()-f.scale())
          throw new InvalidInputField(f.name(),"out_of_range");
        if(fractionalDigits>f.scale())throw new InvalidInputField(f.name(),"invalid_format");
        BigDecimal decimal=new BigDecimal(s);
        if((f.decimalMin()!=null && decimal.compareTo(new BigDecimal(f.decimalMin()))<0) ||
           (f.decimalMax()!=null && decimal.compareTo(new BigDecimal(f.decimalMax()))>0))
          throw new InvalidInputField(f.name(),"out_of_range");
      } else if (f.type().equals("utcDateTime")) {
        if (!(v instanceof String s)) throw new InvalidInputField(f.name(),"invalid_type");
        try { OffsetDateTime.parse(s); } catch (RuntimeException ex) { throw new InvalidInputField(f.name(),"invalid_format"); }
      } else {
        throw new IllegalStateException("Unsupported field type");
      }
    }
    if(create)for(var field : e.fields()){
      if(field.afterField()==null)continue;
      String startValue=(String)body.get(field.afterField());
      String strict="^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:[.]\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$";
      if(!Pattern.matches(strict,startValue))
        throw new InvalidInputField(field.afterField(),"invalid_format");
      if(!body.containsKey(field.name()))continue;
      String endValue=(String)body.get(field.name());
      if(!Pattern.matches(strict,endValue))
        throw new InvalidInputField(field.name(),"invalid_format");
      OffsetDateTime start=OffsetDateTime.parse(startValue);
      OffsetDateTime end=OffsetDateTime.parse(endValue);
      // Match the milliseconds used by the generated JS runtime and React.
      if(!end.toInstant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)
             .isAfter(start.toInstant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)))
        throw new InvalidInputField(field.name(),"invalid_order");
    }
    if(create)for(var field : e.fields()){
      if(field.greaterThanField()==null||!body.containsKey(field.name()))continue;
      Object source=body.get(field.greaterThanField()),target=body.get(field.name());
      if(field.type().equals("decimal")){
        if(!(source instanceof String left)||!(target instanceof String right))
          throw new InvalidInputField(field.name(),"invalid_type");
        if(new BigDecimal(right).compareTo(new BigDecimal(left))<=0)
          throw new InvalidInputField(field.name(),"invalid_comparison");
      }else{
        if(!(source instanceof Integer start))
          throw new InvalidInputField(field.greaterThanField(),"invalid_type");
        if(!(target instanceof Integer end)||end<=start)
          throw new InvalidInputField(field.name(),"invalid_comparison");
      }
    }
  }

  private Object sqlValue(Manifest.Field f, Object v) {
    if (v instanceof String s && f.type().equals("utcDateTime")) return OffsetDateTime.parse(s);
    if (v instanceof String s && f.type().equals("decimal")) return new BigDecimal(s);
    return v;
  }

  private boolean constraintSqlState(Throwable error, String state) {
    for (Throwable cause=error;cause!=null;cause=cause.getCause())
      if (cause instanceof SQLException sql && state.equals(sql.getSQLState())) return true;
    return false;
  }

  private int parseDocumentVersion(String header) {
    if(header==null||!header.matches("\"[1-9][0-9]{0,9}\""))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Expected a strong If-Match document version");
    try{
      int version=Integer.parseInt(header.substring(1,header.length()-1));
      if(version<1)throw new NumberFormatException();
      return version;
    }catch(NumberFormatException error){
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid document version",error);
    }
  }

  private void assertDocumentVersion(Manifest.Entity parent,String id,String ifMatch) {
    int expected=parseDocumentVersion(ifMatch);
    var creator=Manifest.OPS.stream().filter(o->o.entity().equals(parent.name())&&
      o.createDetails()!=null&&o.createDetails().versioned()).findFirst().orElse(null);
    var closure=creator==null?null:creator.createDetails();
    String column=closure==null||closure.closeField().isEmpty()?"":parent.fields().stream()
      .filter(x->x.name().equals(closure.closeField())).findFirst().orElseThrow().column();
    var values=jdbc.queryForList("SELECT document_version"+
      (column.isEmpty()?"":","+column+" AS document_state")+" FROM "+parent.table()+
      " WHERE "+parent.identityColumn()+"=:id FOR UPDATE",Map.of("id",id));
    if(values.size()!=1)
      throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Versioned document not found");
    if(((Number)values.get(0).get("document_version")).intValue()!=expected)
      throw new ResponseStatusException(HttpStatus.CONFLICT,"Stale document version");
    if(!column.isEmpty()&&closure.closeState().equals(values.get(0).get("document_state")))
      throw new ResponseStatusException(HttpStatus.CONFLICT,"Document already closed");
  }

  private void incrementDocumentVersion(Manifest.Entity parent,String id) {
    int changed=jdbc.update("UPDATE "+parent.table()+
      " SET document_version=document_version+1 WHERE "+parent.identityColumn()+
      "=:id AND document_version<2147483647",Map.of("id",id));
    if(changed!=1)
      throw new ResponseStatusException(HttpStatus.CONFLICT,"Document version exhausted");
  }

  private Map<String,Object> create(Manifest.Entity e, Manifest.Op op, Map<String,Object> body,
      Authentication user,String ifMatch,boolean nested) {
    // A financial detail is immutable after its parent's atomic initial INSERT.
    // The nested header workflow is allowed; independent child POST is not.
    if(!nested&&Manifest.OPS.stream().anyMatch(x->x.createDetails()!=null&&
        e.name().equals(x.createDetails().childEntity())&&
        !x.createDetails().chargeAmountField().isEmpty()))
      throw new ResponseStatusException(HttpStatus.CONFLICT,"Exact charge rows are immutable");
    // Nested DTO is validated against the declared child entity, not flattened into parent SQL.
    java.util.List<Map<String,Object>> details=null;
    Manifest.Entity detailEntity=null;
    Manifest.Op detailCreate=null;
    if(op.createDetails()!=null){
      var plan=op.createDetails();
      if(body==null||!(body.get(plan.rowsField()) instanceof java.util.List<?> inputRows)||
          inputRows.isEmpty()||inputRows.size()>plan.maxRows())
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Expected 1..20 detail rows");
      detailEntity=Manifest.ENTITIES.stream().filter(x->x.name().equals(plan.childEntity()))
          .findFirst().orElseThrow();
      detailCreate=Manifest.OPS.stream().filter(x->x.entity().equals(plan.childEntity())&&
          x.kind().equals("create")).findFirst().orElseThrow();
      details=new java.util.ArrayList<>();
      for(var raw:inputRows){
        if(!(raw instanceof Map<?,?> row)||row.keySet().stream().anyMatch(k->!(k instanceof String)))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid detail row object");
        var entry=new java.util.LinkedHashMap<String,Object>();
        for(var pair:row.entrySet())entry.put((String)pair.getKey(),pair.getValue());
        if(entry.containsKey(plan.parentField()))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Child parent FK is server-managed");
        entry.put(plan.parentField(),body.get(e.identity()));
        validate(detailEntity,entry,true,detailEntity.fields().stream()
          .filter(x->!x.computed()).map(Manifest.Field::name).collect(java.util.stream.Collectors.toSet()));
        details.add(entry);
      }
      body=new java.util.LinkedHashMap<>(body);
      body.remove(plan.rowsField());
      if(!plan.chargeAmountField().isEmpty()){
        if(body.containsKey(plan.chargeTotalField()))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Client cannot supply charge total");
        BigDecimal total=BigDecimal.ZERO;
        for(var detail:details)
          total=total.add(new BigDecimal((String)detail.get(plan.chargeAmountField())));
        // The parent exact-decimal constraints validate the summed total
        // before any INSERT; child rows were validated above.
        body.put(plan.chargeTotalField(),total.toPlainString());
      }
    }
    String subject=user.getName();
    if(e.ownerField()!=null){
      if(body==null||body.containsKey(e.ownerField()))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Owner field cannot be supplied");
      body=new java.util.LinkedHashMap<>(body);
      body.put(e.ownerField(),subject);
    }
    // Bind the server-managed opening/available values *before* generic
    // required-field validation, while rejecting all client-supplied copies.
    var derivedLedger=Manifest.EXACT_RECONCILIATIONS.values().stream()
      .filter(x -> e.name().equals(x.parentEntity())).findFirst().orElse(null);
    if(derivedLedger!=null&&derivedLedger.serverOnly()){
      if(body==null||body.containsKey(derivedLedger.openingField())||
          body.containsKey(derivedLedger.availableField()))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Server-managed balance cannot be supplied");
      body=new java.util.LinkedHashMap<>(body);
      // Temporary typed zero only for the first exact-decimal input validation.
      // The actual total is computed after every source has passed validation.
      body.put(derivedLedger.openingField(),"0");
      body.put(derivedLedger.availableField(),"0");
    }
    if(body==null)
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Missing create body");
    for(var field:e.fields())if(field.fixedInitial()&&body.containsKey(field.name()))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Server-owned fixed field cannot be supplied");
    Set<String> fields = e.fields().stream().filter(f -> !f.computed()).map(Manifest.Field::name).collect(java.util.stream.Collectors.toSet());
    validate(e, body, true, fields);
    if(derivedLedger!=null&&derivedLedger.serverOnly()){
      BigDecimal total=BigDecimal.ZERO;
      for(String source:derivedLedger.chargeSources())
        total=total.add(new BigDecimal((String)body.get(source)));
      String calculated=total.toPlainString();
      body.put(derivedLedger.openingField(),calculated);
      body.put(derivedLedger.availableField(),calculated);
      // Runtime bounds apply to the SUM, not just its individually valid terms.
      validate(e,body,true,fields);
    }
    if(op.moveBatch()!=null){
      // No client may impersonate a reversed or posted ledger entry.
      var state=Manifest.OPS.stream().filter(x->x.entity().equals(e.name())&&x.reverseBatch()!=null)
          .map(Manifest.Op::field).findFirst().orElse(null);
      if(state!=null&&body.containsKey(state))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Batch lifecycle state is server-managed");
    }
    if(op.moveUnits()!=null){
      // Check the ORIGINAL client payload, before the server injects @initial fields.
      var state=Manifest.OPS.stream().filter(x->x.entity().equals(e.name())&&x.reverseUnits()!=null)
          .map(Manifest.Op::field).findFirst().orElse(null);
      if(state!=null&&body.containsKey(state))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Initial transfer state is server-managed");
    }
    body = new java.util.LinkedHashMap<>(body);
    for (var f : e.fields()) if (f.initial()!=null && !body.containsKey(f.name()))
      body.put(f.name(),f.initial());
    // Bind opening-balance integrity to the declaring parent entity, never coincidental field names.
    var reconciliation=Manifest.EXACT_RECONCILIATIONS.values().stream()
      .filter(x -> e.name().equals(x.parentEntity())).findFirst().orElse(null);
    if(reconciliation!=null){
      BigDecimal opening=new BigDecimal((String)body.get(reconciliation.openingField()));
      BigDecimal available=new BigDecimal((String)body.get(reconciliation.availableField()));
      if(opening.compareTo(available)!=0)
        throw new InvalidInputField(reconciliation.availableField(),"invalid_comparison");
      if(!reconciliation.chargeSources().isEmpty()){
        BigDecimal total=BigDecimal.ZERO;
        for(String source:reconciliation.chargeSources())
          total=total.add(new BigDecimal((String)body.get(source)));
        if(opening.compareTo(total)!=0)
          throw new InvalidInputField(reconciliation.openingField(),"invalid_comparison");
        // Persist the canonical multi-charge amount, never client duplicates.
        body.put(reconciliation.openingField(),total.toPlainString());
        body.put(reconciliation.availableField(),total.toPlainString());
      }
    }
    if(op.moveBatch()!=null){
      var batch=op.moveBatch();
      var deltas=new java.util.TreeMap<String,Long>();
      for(var leg:batch.legs()){
        Object src=body.get(leg.sourceField()),dst=body.get(leg.targetField()),
            raw=body.get(leg.quantityField());
        if(!(src instanceof String from)||!(dst instanceof String to)||
           !(raw instanceof Integer amount)||amount<1||from.equals(to))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid multi-leg transfer");
        deltas.merge(from,-(long)amount,Long::sum);
        deltas.merge(to,(long)amount,Long::sum);
      }
      var ids=new java.util.ArrayList<String>(deltas.keySet());
      // Always lock ALL involved rows in stable order before writing any of them.
      var locked=jdbc.queryForList("SELECT "+batch.stockKeyColumn()+" FROM "+
          batch.stockTable()+" WHERE "+batch.stockKeyColumn()+
          " IN (:ids) ORDER BY "+batch.stockKeyColumn()+" FOR UPDATE",
          Map.of("ids",ids),String.class);
      if(locked.size()!=ids.size())
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"One or more transfer accounts do not exist");
      for(var entry:deltas.entrySet()){
        long delta=entry.getValue();
        if(delta==0L)continue;
        long minimum=delta<0?-delta:0L;
        long maximum=delta>0?batch.maxBalance()-delta:batch.maxBalance();
        if(minimum>batch.maxBalance()||maximum<0)
          throw new ResponseStatusException(HttpStatus.CONFLICT,"Multi-leg balance limit exceeded");
        int changed=jdbc.update("UPDATE "+batch.stockTable()+" SET "+
          batch.availableColumn()+"="+batch.availableColumn()+"+:delta WHERE "+
          batch.stockKeyColumn()+"=:id AND "+batch.availableColumn()+">=:minimum AND "+
          batch.availableColumn()+"<=:maximum",
          new MapSqlParameterSource().addValue("id",entry.getKey())
            .addValue("delta",delta).addValue("minimum",minimum).addValue("maximum",maximum));
        if(changed!=1)
          throw new ResponseStatusException(HttpStatus.CONFLICT,"Multi-leg balance outside allowed range");
      }
    }
    // B8: both parent rows lock in canonical public-key order to avoid reverse-direction
    // transfer deadlocks. The same dispatch() transaction also inserts the journal row.
    if(op.moveUnits()!=null){
      var movement=op.moveUnits();
      Object fromRaw=body.get(movement.sourceField());
      Object toRaw=body.get(movement.targetField());
      Object quantityRaw=body.get(movement.amountField());
      if(!(fromRaw instanceof String from)||!(toRaw instanceof String to)||
          !(quantityRaw instanceof Integer units)||units<1||from.equals(to))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid stock transfer");
      var lockParams=Map.of("source",from,"target",to);
      var locked=jdbc.queryForList("SELECT "+movement.stockKeyColumn()+
          " FROM "+movement.stockTable()+" WHERE "+movement.stockKeyColumn()+
          " IN (:source,:target) ORDER BY "+movement.stockKeyColumn()+" FOR UPDATE",
          lockParams,String.class);
      if(locked.size()!=2)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Transfer stock item missing");
      var mutation=new MapSqlParameterSource().addValue("from",from)
          .addValue("target",to).addValue("units",units)
          .addValue("maxAfter",movement.maxBalance()-units);
      int debited=jdbc.update("UPDATE "+movement.stockTable()+" SET "+
          movement.availableColumn()+"="+movement.availableColumn()+"-:units WHERE "+
          movement.stockKeyColumn()+"=:from AND "+movement.availableColumn()+">=:units",mutation);
      if(debited!=1)
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Insufficient transferable units");
      int credited=jdbc.update("UPDATE "+movement.stockTable()+" SET "+
          movement.availableColumn()+"="+movement.availableColumn()+"+:units WHERE "+
          movement.stockKeyColumn()+"=:target AND "+movement.availableColumn()+"<=:maxAfter",mutation);
      if(credited!=1)
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Destination capacity exceeded");
    }
    // dispatch() is @Transactional: failure inserting the child rolls back this debit.
    if (op.reserve()!=null) {
      var reserve=op.reserve();
      String stock=(String)body.get(reserve.referenceField());
      Integer amount=(Integer)body.get(reserve.amountField());
      if (stock==null || amount==null || amount < 1)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid reservation");
      int debited=jdbc.update("UPDATE "+reserve.stockTable()+" SET "+
          reserve.availableColumn()+"="+reserve.availableColumn()+"-:amount WHERE "+
          reserve.stockKeyColumn()+"=:stock AND "+reserve.availableColumn()+">=:amount",
          Map.of("stock",stock,"amount",amount));
      if (debited==0) {
        Number exists=jdbc.queryForObject("SELECT COUNT(*) FROM "+reserve.stockTable()+
            " WHERE "+reserve.stockKeyColumn()+"=:stock",
            Map.of("stock",stock),Number.class);
        if (exists==null || exists.intValue()==0)
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Stock item does not exist");
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Insufficient availability");
      }
    }
    if(op.exactDebit()!=null){
      var debit=op.exactDebit();
      Object id=body.get(debit.referenceField()),raw=body.get(debit.amountField());
      if(!(id instanceof String key)||!(raw instanceof String wire))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid exact debit input");
      BigDecimal amount=new BigDecimal(wire);
      if(amount.signum()<=0)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Nonpositive debit");
      requireConsistentExactLedger(debit.balanceTable(),debit.balanceKey(),key);
      int changed=jdbc.update("UPDATE "+debit.balanceTable()+" SET "+
          debit.balanceColumn()+"="+debit.balanceColumn()+"-:amount WHERE "+
          debit.balanceKey()+"=:key AND "+debit.balanceColumn()+">=:amount",
          Map.of("key",key,"amount",amount));
      if(changed==0){
        Number found=jdbc.queryForObject("SELECT COUNT(*) FROM "+debit.balanceTable()+
            " WHERE "+debit.balanceKey()+"=:key",Map.of("key",key),Number.class);
        throw new ResponseStatusException(found!=null&&found.intValue()>0?
            HttpStatus.CONFLICT:HttpStatus.BAD_REQUEST,"Missing or insufficient exact balance");
      }
    }
    // B17 foundation: even legacy single-line POSTs must respect the document's
    // declared bounded collection. Lock the header inside dispatch()'s transaction
    // before counting so concurrent appends cannot both claim the last slot.
    var boundedCreator=Manifest.OPS.stream()
      .filter(x->x.createDetails()!=null && x.createDetails().childEntity().equals(e.name()))
      .findFirst().orElse(null);
    Manifest.Entity versionedParent=null;
    String versionedParentId=null;
    if(boundedCreator!=null){
      // A child-write permission alone must never authorize mutating a header.
      if(user==null||user.getAuthorities().stream().noneMatch(
          a->a.getAuthority().equals(boundedCreator.capability())))
        throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Parent write permission required");
      var bound=boundedCreator.createDetails();
      var parent=Manifest.ENTITIES.stream().filter(x->x.name().equals(boundedCreator.entity()))
        .findFirst().orElseThrow();
      Object raw=body.get(bound.parentField());
      if(!(raw instanceof String parentId)||parentId.isBlank())
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid detail parent");
      var locked=jdbc.queryForList("SELECT "+parent.identityColumn()+" FROM "+parent.table()+
        " WHERE "+parent.identityColumn()+"=:id FOR UPDATE",Map.of("id",parentId),String.class);
      if(locked.size()!=1)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Detail parent not found");
      if(bound.versioned()&&!nested){
        assertDocumentVersion(parent,parentId,ifMatch);
        versionedParent=parent;
        versionedParentId=parentId;
      }
      String fk=e.fields().stream().filter(f->f.name().equals(bound.parentField()))
        .findFirst().orElseThrow().column();
      Number used=jdbc.queryForObject("SELECT COUNT(*) FROM "+e.table()+
        " WHERE "+fk+"=:id",Map.of("id",parentId),Long.class);
      if(used==null||used.longValue()>=bound.maxRows())
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Document detail limit reached");
    }
    var params = new MapSqlParameterSource();
    for (var f : e.fields()) if (!f.computed()) params.addValue(f.name(), sqlValue(f, body.get(f.name())));
    String names = e.fields().stream().filter(f -> !f.computed()).map(Manifest.Field::column).reduce((a,b)->a+","+b).orElseThrow();
    String values = e.fields().stream().filter(f -> !f.computed()).map(f -> ":" + f.name()).reduce((a,b)->a+","+b).orElseThrow();
    var relation=e.ownerRelation();
    if(relation!=null){
      if(user.getAuthorities().stream().noneMatch(a->a.getAuthority().equals(relation.parentReadCapability())))
        throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Parent read permission required");
      params.addValue("parentKey",body.get(relation.field())).addValue("authenticatedOwner",subject);
    }
    String insert="INSERT INTO "+e.table()+" ("+names+") "+
      (relation==null?"VALUES ("+values+")":"SELECT "+values+" WHERE EXISTS (SELECT 1 FROM "+
        relation.parentTable()+" WHERE "+relation.parentKey()+"=:parentKey AND "+
        relation.parentOwnerColumn()+"=:authenticatedOwner)");
    try {
      int changed=jdbc.update(insert,params);
      if(relation!=null&&changed==0)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Referenced resource unavailable");
    } catch (DataIntegrityViolationException ex) {
      if (constraintSqlState(ex,"23503"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Referenced resource does not exist");
      if (constraintSqlState(ex,"23505"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Duplicate unique value");
      if (constraintSqlState(ex,"23502") || constraintSqlState(ex,"23514"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Database constraint violation");
      throw ex;
    }
    if(details!=null)for(var detail:details)create(detailEntity,detailCreate,detail,user,null,true);
    if(versionedParent!=null)incrementDocumentVersion(versionedParent,versionedParentId);
    return row(e, (String) body.get(e.identity()),subject);
  }

  private Map<String,Object> page(Manifest.Entity e, Map<String,String> query, Manifest.Op op, String subject) {
    if (!query.keySet().stream().allMatch(k -> k.equals("limit") || k.equals("offset")))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    int limit, offset;
    try {
      limit = Integer.parseInt(query.getOrDefault("limit", String.valueOf(op.limitDefault())));
      offset = Integer.parseInt(query.getOrDefault("offset", String.valueOf(op.offsetDefault())));
    } catch (NumberFormatException ex) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST); }
    if (limit < op.limitMin() || limit > op.limitMax() || offset < 0 || offset > op.offsetMax())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var args=new MapSqlParameterSource().addValue("limit",limit).addValue("offset",offset);
    if(e.ownerField()!=null){
      if(subject==null)throw new ResponseStatusException(HttpStatus.FORBIDDEN);
      args.addValue("owner",subject);
    }
    String predicate=e.ownerField()==null?"":" WHERE "+e.ownerColumn()+"=:owner";
    var result=jdbc.queryForList(selectSql(e)+predicate+" ORDER BY "+e.identityColumn()+
      " LIMIT :limit OFFSET :offset",args);
    List<Map<String,Object>> items = result.stream().map(r -> serialized(r, e)).toList();
    Number count=jdbc.queryForObject("SELECT COUNT(*) FROM "+e.table()+predicate,args,Number.class);
    return Map.of("items", items, "total", count.intValue(), "limit", limit, "offset", offset);
  }

  private Map<String,Object> queryPage(Manifest.Entity entity,Map<String,String> query,Manifest.Op operation) {
    Manifest.QuerySpec plan=Manifest.QUERIES.get(operation.name());
    if(plan==null)throw new IllegalStateException("Unresolved generated query");
    var allowed=new java.util.HashSet<String>();
    allowed.add("limit");allowed.add("offset");
    for(var f:plan.filters())allowed.add(f.name());
    if(!allowed.containsAll(query.keySet()))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Unknown filter");
    int limit,offset;
    try {
      limit=Integer.parseInt(query.getOrDefault("limit",String.valueOf(operation.limitDefault())));
      offset=Integer.parseInt(query.getOrDefault("offset",String.valueOf(operation.offsetDefault())));
    } catch(NumberFormatException ex) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid pagination");
    }
    if(limit<operation.limitMin()||limit>operation.limitMax()||offset<0||offset>operation.offsetMax())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Page out of bounds");
    var args=new MapSqlParameterSource().addValue("limit",limit).addValue("offset",offset);
    var where=new StringBuilder(" WHERE TRUE");
    var lower=new java.util.HashMap<String,Comparable>();
    var upper=new java.util.HashMap<String,Comparable>();
    for(var filter:plan.filters()){
      if(!query.containsKey(filter.name()))continue;
      String value=query.get(filter.name());
      Object parsed;
      if(filter.type().equals("string")){
        if(value==null||value.isBlank()||
           (filter.minLength()!=null&&value.length()<filter.minLength())||
           (filter.maxLength()!=null&&value.length()>filter.maxLength())||
           (filter.pattern()!=null&&!Pattern.matches(filter.pattern(),value)))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid text filter");
        parsed=value;
      }else if(filter.type().equals("int32")){
        try {
          int number=Integer.parseInt(value);
          if((filter.min()!=null&&number<filter.min())||
             (filter.max()!=null&&number>filter.max()))
            throw new NumberFormatException();
          parsed=number;
        }catch(NumberFormatException ex){
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid integer filter");
        }
      }else if(filter.type().equals("utcDateTime")){
        try {parsed=OffsetDateTime.parse(value);}
        catch(RuntimeException ex){
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid timestamp filter");
        }
      }else throw new IllegalStateException("Unsupported declared filter");
      if(filter.comparator().equals(">="))lower.put(filter.expression(),(Comparable)parsed);
      if(filter.comparator().equals("<="))upper.put(filter.expression(),(Comparable)parsed);
      // Only allowlisted columns can be searched; wildcard input stays literal.
      if(filter.comparator().equals("ILIKE"))
        parsed="%"+value.replace("!","!!").replace("%","!%").replace("_","!_")+"%";
      args.addValue(filter.name(),parsed);
      where.append(" AND ").append(filter.expression()).append(" ")
          .append(filter.comparator()).append(" :").append(filter.name());
      if(filter.comparator().equals("ILIKE"))where.append(" ESCAPE '!'");

    }
    for(var key:lower.keySet()){
      if(upper.containsKey(key)&&lower.get(key).compareTo(upper.get(key))>0)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Inverted query range");
    }
    var rows=jdbc.queryForList(plan.projection()+plan.source()+where+plan.order()+
      " LIMIT :limit OFFSET :offset",args);
    Number total=jdbc.queryForObject("SELECT COUNT(*) "+plan.source()+where,args,Number.class);
    var items=rows.stream().map(row->serialized(row,entity)).toList();
    return Map.of("items",items,"total",total.intValue(),"limit",limit,"offset",offset);
  }

  private Map<String,Object> auditPage(Manifest.Entity e,String key,Map<String,String> query,Manifest.Op op) {
    if(key==null||!query.keySet().stream().allMatch(k -> k.equals("limit") || k.equals("offset")))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    int limit,offset;
    try{
      limit=Integer.parseInt(query.getOrDefault("limit",String.valueOf(op.limitDefault())));
      offset=Integer.parseInt(query.getOrDefault("offset",String.valueOf(op.offsetDefault())));
    }catch(NumberFormatException ex){throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
    if(limit<op.limitMin()||limit>op.limitMax()||offset<0||offset>op.offsetMax())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    row(e,key); // Preserve resource 404 after capability enforcement; do not disclose other resources.
    String where=" WHERE entity_name=:entity AND resource_id=:key";
    var args=new MapSqlParameterSource().addValue("entity",e.name()).addValue("key",key)
        .addValue("limit",limit).addValue("offset",offset);
    String projection="SELECT id::text AS \"id\", actor, entity_name AS \"entityName\", "+
        "resource_id AS \"resourceId\", operation_name AS \"operationName\", "+
        "field_name AS \"fieldName\", before_value AS \"beforeValue\", "+
        "after_value AS \"afterValue\", "+
        "to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || "+
        "to_char(occurred_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' AS \"occurredAt\" "+
        "FROM protocolia_audit_event";
    var rows=jdbc.queryForList(projection+where+" ORDER BY id DESC LIMIT :limit OFFSET :offset",args);
    Number total=jdbc.queryForObject("SELECT COUNT(*) FROM protocolia_audit_event"+where,args,Number.class);
    return Map.of("items",rows,"total",total.intValue(),"limit",limit,"offset",offset);
  }

  // All compound-key columns change in ONE statement. PostgreSQL's UNIQUE constraint
  // arbitrates races; a conflict rolls back the entire update transaction.
  private Map<String,Object> patchTogether(Manifest.Entity e, Manifest.Op op,
      String id, Map<String,Object> body, String subject) {
    String[] keys=op.input().split(",",-1);
    if(keys.length<2||keys.length>4||
       java.util.Arrays.stream(keys).distinct().count()!=keys.length||
       body==null||body.size()!=keys.length||
       !body.keySet().containsAll(java.util.Arrays.asList(keys)))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Expected all compound key fields");
    validate(e,body,false,Set.copyOf(java.util.Arrays.asList(keys)));
    if(e.ownerField()!=null && subject==null)
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    var args=new MapSqlParameterSource().addValue("id",id);
    var assignments=new ArrayList<String>();
    for(int i=0;i<keys.length;i++){
      String fieldName=keys[i];
      var field=e.fields().stream().filter(x->x.name().equals(fieldName)).findFirst().orElseThrow();
      String param="value"+i;
      assignments.add(field.column()+"=:"+param);
      args.addValue(param,body.get(fieldName));
    }
    String ownerGuard=e.ownerField()==null?"":" AND "+e.ownerColumn()+"=:owner";
    if(e.ownerField()!=null)args.addValue("owner",subject);
    int changed;
    try{
      changed=jdbc.update("UPDATE "+e.table()+" SET "+
        String.join(",",assignments)+" WHERE "+e.identityColumn()+"=:id"+ownerGuard,args);
    }catch(DataIntegrityViolationException ex){
      if(constraintSqlState(ex,"23505"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Duplicate business combination",ex);
      if(constraintSqlState(ex,"23514")||constraintSqlState(ex,"23502"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Constraint violation",ex);
      throw ex;
    }
    if(changed==0)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return row(e,id,subject);
  }

  private Map<String,Object> patch(Manifest.Entity e, Manifest.Op op, String id,
      Map<String,Object> body, String subject,String ifMatch) {
    if(op.audit().isEmpty()){
      validate(e, body, false, Set.of(op.field()));
      if (!body.containsKey(op.input())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    }else{
      if(body==null||body.size()!=2||!body.containsKey(op.input())||
          !body.containsKey("expected")||body.get(op.input())==null||
          body.get("expected")==null)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Expected non-null field and previous value");
      if(body.get(op.input()).equals(body.get("expected")))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"New value matches the previous value");
      validate(e,Map.of(op.input(),body.get(op.input())),false,Set.of(op.field()));
      validate(e,Map.of(op.input(),body.get("expected")),false,Set.of(op.field()));
    }
    var versionedCreator=Manifest.OPS.stream()
      .filter(x->x.createDetails()!=null&&x.createDetails().versioned()&&
        x.createDetails().childEntity().equals(e.name())).findFirst().orElse(null);
    Manifest.Entity versionedParent=null;
    String versionedParentId=null;
    if(versionedCreator!=null){
      if(id==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
      var plan=versionedCreator.createDetails();
      var field=e.fields().stream().filter(f->f.name().equals(plan.parentField())).findFirst().orElseThrow();
      var keys=jdbc.queryForList("SELECT "+field.column()+" FROM "+e.table()+
        " WHERE "+e.identityColumn()+"=:id",Map.of("id",id),String.class);
      if(keys.size()!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      versionedParentId=keys.get(0);
      versionedParent=Manifest.ENTITIES.stream().filter(x->x.name().equals(versionedCreator.entity()))
        .findFirst().orElseThrow();
      assertDocumentVersion(versionedParent,versionedParentId,ifMatch);
    }
    String col = e.fields().stream().filter(f -> f.name().equals(op.field())).findFirst().orElseThrow().column();
    if(e.ownerField()!=null&&(subject==null||e.ownerField().equals(op.field())))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    var params=new MapSqlParameterSource().addValue("key",id).addValue("value",body.get(op.input()));
    if(e.ownerField()!=null)params.addValue("owner",subject);
    String guard=e.ownerField()==null?"":" AND "+e.ownerColumn()+"=:owner";
    if(!op.audit().isEmpty()){
      params.addValue("expected",body.get("expected"));
      guard+=" AND "+col+"=:expected";
    }
    int changed;
    try {
      // CAS arbitrates stale writers without read-before-write races.
      changed=jdbc.update("UPDATE "+e.table()+" SET "+col+"=:value WHERE "+e.identityColumn()+"=:key"+guard,params);
    } catch (DataIntegrityViolationException ex) {
      if(constraintSqlState(ex,"23505"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Compound business key already exists",ex);
      if(constraintSqlState(ex,"23514")||constraintSqlState(ex,"23502"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Constraint violation",ex);
      throw ex;
    }
    if(changed==0){
      row(e,id,subject);
      throw new ResponseStatusException(HttpStatus.CONFLICT,"Stale expected value");
    }
    if(versionedParent!=null)incrementDocumentVersion(versionedParent,versionedParentId);
    return row(e,id,subject);
  }

  private Map<String,Object> reassignReference(Manifest.Entity e, Manifest.Op op, String id, Map<String,Object> body) {
    if(id==null||body==null||body.size()!=2||!body.containsKey("expected")||!body.containsKey(op.input()))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Expected previous and new reference");
    var previous=body.get("expected");
    var next=body.get(op.input());
    if(previous==null||next==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    validate(e,Map.of(op.input(),previous),false,Set.of(op.input()));
    validate(e,Map.of(op.input(),next),false,Set.of(op.input()));
    if(previous.equals(next))throw new ResponseStatusException(HttpStatus.CONFLICT,"Relation is unchanged");
    String col=e.fields().stream().filter(f->f.name().equals(op.field())).findFirst().orElseThrow().column();
    try {
      int changed=jdbc.update("UPDATE "+e.table()+" SET "+col+"=:next WHERE "+
          e.identityColumn()+"=:key AND "+col+"=:expected",
          Map.of("key",id,"expected",previous,"next",next));
      if(changed==0){
        row(e,id);
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Reference changed concurrently");
      }
    }catch(DataIntegrityViolationException ex){
      if(constraintSqlState(ex,"23503"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Referenced resource does not exist");
      throw ex;
    }
    return row(e,id);
  }

  private Map<String,Object> replaceDetails(Manifest.Entity parent,Manifest.Op op,String id,
      Map<String,Object> body,Authentication user,String ifMatch) {
    var creator=Manifest.OPS.stream().filter(x->x.entity().equals(parent.name())&&
      x.createDetails()!=null&&x.createDetails().versioned()).findFirst()
      .orElseThrow(()->new IllegalStateException("Missing versioned details creator"));
    var plan=creator.createDetails();
    var child=Manifest.ENTITIES.stream().filter(x->x.name().equals(plan.childEntity()))
      .findFirst().orElseThrow();
    var createOp=Manifest.OPS.stream().filter(x->x.entity().equals(child.name())&&
      x.kind().equals("create")).findFirst().orElseThrow();
    var deleteOp=Manifest.OPS.stream().filter(x->x.entity().equals(child.name())&&
      x.kind().equals("delete")).findFirst().orElseThrow();
    if(user==null||user.getAuthorities().stream().noneMatch(a->
       a.getAuthority().equals(createOp.capability()))||
       user.getAuthorities().stream().noneMatch(a->
       a.getAuthority().equals(deleteOp.capability())))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Both child mutation permissions required");
    if(id==null||body==null||body.size()!=1||
       !(body.get(plan.rowsField()) instanceof java.util.List<?> rows)||
       rows.isEmpty()||rows.size()>plan.maxRows())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Expected 1..20 replacement rows");
    var writable=child.fields().stream().filter(f->!f.computed())
      .map(Manifest.Field::name).collect(java.util.stream.Collectors.toSet());
    var incoming=new java.util.ArrayList<Map<String,Object>>();
    var keys=new java.util.HashSet<String>();
    for(var raw:rows){
      if(!(raw instanceof Map<?,?> values)||values.keySet().stream()
          .anyMatch(x->!(x instanceof String)))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid replacement row");
      var row=new java.util.LinkedHashMap<String,Object>();
      for(var item:values.entrySet())row.put((String)item.getKey(),item.getValue());
      if(row.containsKey(plan.parentField()))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Parent reference is server-managed");
      row.put(plan.parentField(),id);
      validate(child,row,true,writable);
      var key=(String)row.get(child.identity());
      if(!keys.add(key))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Duplicate replacement identity");
      incoming.add(row);
    }
    // Same parent-first lock as all B17 child mutations.
    assertDocumentVersion(parent,id,ifMatch);
    String fk=child.fields().stream().filter(x->x.name().equals(plan.parentField()))
      .findFirst().orElseThrow().column();
    var before=jdbc.queryForList(selectSql(child)+" WHERE "+fk+"=:parent ORDER BY "+
      child.identityColumn(),Map.of("parent",id));
    try{
      jdbc.update("DELETE FROM "+child.table()+" WHERE "+fk+"=:parent",Map.of("parent",id));
      for(var old:before)for(String field:deleteOp.audit()){
        Object value=old.get(field);
        jdbc.update("INSERT INTO protocolia_audit_event "+
          "(actor,entity_name,resource_id,operation_name,field_name,before_value,after_value) "+
          "VALUES (:actor,:entity,:id,:op,:field,:old,NULL)",
          new MapSqlParameterSource().addValue("actor",user.getName())
            .addValue("entity",child.name()).addValue("id",old.get(child.identity()))
            .addValue("op",deleteOp.name()).addValue("field",field)
            .addValue("old",value==null?null:String.valueOf(value)));
      }
      var persisted=child.fields().stream().filter(f->!f.computed()).toList();
      String columns=persisted.stream().map(Manifest.Field::column).collect(java.util.stream.Collectors.joining(","));
      String binds=persisted.stream().map(f->":"+f.name()).collect(java.util.stream.Collectors.joining(","));
      for(var entry:incoming){
        var params=new MapSqlParameterSource();
        for(var field:persisted)params.addValue(field.name(),sqlValue(field,entry.get(field.name())));
        jdbc.update("INSERT INTO "+child.table()+" ("+columns+") VALUES ("+binds+")",params);
        for(String field:createOp.audit()){
          Object value=entry.get(field);
          jdbc.update("INSERT INTO protocolia_audit_event "+
            "(actor,entity_name,resource_id,operation_name,field_name,before_value,after_value) "+
            "VALUES (:actor,:entity,:id,:op,:field,NULL,:next)",
            new MapSqlParameterSource().addValue("actor",user.getName())
              .addValue("entity",child.name()).addValue("id",entry.get(child.identity()))
              .addValue("op",createOp.name()).addValue("field",field)
              .addValue("next",value==null?null:String.valueOf(value)));
        }
      }
      incrementDocumentVersion(parent,id);
    }catch(DataIntegrityViolationException error){
      if(constraintSqlState(error,"23505")||constraintSqlState(error,"23503"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Replacement collides with existing references");
      if(constraintSqlState(error,"23502")||constraintSqlState(error,"23514"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid replacement data");
      throw error;
    }
    return row(parent,id,user.getName());
  }

  private Object delete(Manifest.Entity e, Manifest.Op op, String id, Authentication actor,
      String ifMatch, Map<String,Object> body) {
    if(id==null||body!=null&&!body.isEmpty())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"DELETE has no request body");
    var creator=Manifest.OPS.stream().filter(x->x.createDetails()!=null&&
        x.createDetails().childEntity().equals(e.name())).findFirst().orElse(null);
    if(creator==null){
      if(!op.audit().isEmpty())
        throw new IllegalStateException("Nonversioned audited delete is unsupported");
      int affected;
      try{
        affected=jdbc.update("DELETE FROM "+e.table()+" WHERE "+e.identityColumn()+"=:key",Map.of("key",id));
      }catch(DataIntegrityViolationException ex){
        if(constraintSqlState(ex,"23503"))
          throw new ResponseStatusException(HttpStatus.CONFLICT,"Referenced by another resource");
        throw ex;
      }
      if(affected==0)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      return null;
    }
    var plan=creator.createDetails();
    if(!plan.versioned()||op.audit().isEmpty()||!op.audit().contains(plan.parentField()))
      throw new IllegalStateException("Unsafe bounded detail DELETE contract");
    if(actor==null||actor.getAuthorities().stream().noneMatch(a->
        a.getAuthority().equals(creator.capability())))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Parent write permission required");
    // Validate If-Match before exposing the child or touching the database.
    parseDocumentVersion(ifMatch);
    var parent=Manifest.ENTITIES.stream().filter(x->x.name().equals(creator.entity()))
      .findFirst().orElseThrow();
    String fk=e.fields().stream().filter(x->x.name().equals(plan.parentField()))
      .findFirst().orElseThrow().column();
    var childFk=jdbc.queryForList("SELECT "+fk+" FROM "+e.table()+
      " WHERE "+e.identityColumn()+"=:id",Map.of("id",id),String.class);
    if(childFk.size()!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    String parentId=childFk.get(0);
    // Canonical lock order (header before child) matches POST/PATCH and
    // prevents two deletions or an append from violating the collection floor.
    assertDocumentVersion(parent,parentId,ifMatch);
    var params=Map.of("id",id,"parent",parentId);
    var before=jdbc.queryForList(selectSql(e)+" WHERE "+e.identityColumn()+
      "=:id AND "+fk+"=:parent",params);
    if(before.size()!=1)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    Number count=jdbc.queryForObject("SELECT COUNT(*) FROM "+e.table()+
      " WHERE "+fk+"=:parent",Map.of("parent",parentId),Long.class);
    if(count==null||count.longValue()<=1)
      throw new ResponseStatusException(HttpStatus.CONFLICT,"A bounded document requires at least one detail");
    int affected;
    try{
      affected=jdbc.update("DELETE FROM "+e.table()+" WHERE "+e.identityColumn()+
        "=:id AND "+fk+"=:parent",params);
    }catch(DataIntegrityViolationException ex){
      if(constraintSqlState(ex,"23503"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Referenced by another resource");
      throw ex;
    }
    if(affected!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Detail changed concurrently");
    // Old values only: no reconstructed payload, and audit and version commit
    // in the same @Transactional dispatch as the DELETE.
    for(String field:op.audit()){
      Object value=before.get(0).get(field);
      jdbc.update("INSERT INTO protocolia_audit_event "+
        "(actor,entity_name,resource_id,operation_name,field_name,before_value,after_value) "+
        "VALUES (:actor,:entity,:id,:op,:field,:before,NULL)",
        new MapSqlParameterSource().addValue("actor",actor.getName())
          .addValue("entity",e.name()).addValue("id",id)
          .addValue("op",op.name()).addValue("field",field)
          .addValue("before",value==null?null:String.valueOf(value)));
    }
    incrementDocumentVersion(parent,parentId);
    return null;
  }

  private Map<String,Object> transition(Manifest.Entity e, Manifest.Op op, String id,
      Map<String,Object> body,String ifMatch) {
    if (id == null || (body != null && !body.isEmpty()))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Transition does not accept input");
    String col = e.fields().stream().filter(f -> f.name().equals(op.field())).findFirst().orElseThrow().column();
    var documentCreator=Manifest.OPS.stream().filter(o->o.entity().equals(e.name())&&
      o.createDetails()!=null&&o.createDetails().versioned()&&
      !o.createDetails().closeField().isEmpty()&&
      o.createDetails().closeField().equals(op.field())&&
      o.createDetails().closeState().equals(op.toState())).findFirst().orElse(null);
    if(documentCreator!=null){
      assertDocumentVersion(e,id,ifMatch);
      int changed=jdbc.update("UPDATE "+e.table()+" SET "+col+"=:to WHERE "+
        e.identityColumn()+"=:id AND "+col+"=:from",
        Map.of("to",op.toState(),"id",id,"from",op.fromState()));
      if(changed!=1)
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Cannot close document");
      incrementDocumentVersion(e,id);
      return row(e,id);
    }
    if(op.reverseBatch()!=null){
      var reverse=op.reverseBatch();
      var columns=reverse.legs().stream()
          .flatMap(leg->java.util.stream.Stream.of(
            leg.sourceField(),leg.targetField(),leg.quantityField())).toList();
      var lookup=jdbc.queryForList("SELECT "+String.join(",",columns)+" FROM "+e.table()+
        " WHERE "+e.identityColumn()+"=:key",Map.of("key",id));
      if(lookup.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      var saved=lookup.get(0);
      var deltas=new java.util.TreeMap<String,Long>();
      for(var leg:reverse.legs()){
        Object a=saved.get(leg.sourceField()),b=saved.get(leg.targetField()),
          q=saved.get(leg.quantityField());
        if(!(a instanceof String source)||!(b instanceof String target)||
           !(q instanceof Number quantity)||quantity.longValue()<1||source.equals(target))
          throw new ResponseStatusException(HttpStatus.CONFLICT,"Corrupt persisted batch");
        long units=quantity.longValue();
        deltas.merge(source,units,Long::sum);
        deltas.merge(target,-units,Long::sum);
      }
      var ids=new java.util.ArrayList<String>(deltas.keySet());
      var locked=jdbc.queryForList("SELECT "+reverse.stockKeyColumn()+
        " FROM "+reverse.stockTable()+" WHERE "+reverse.stockKeyColumn()+
        " IN (:ids) ORDER BY "+reverse.stockKeyColumn()+" FOR UPDATE",
        Map.of("ids",ids),String.class);
      if(locked.size()!=ids.size())
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Missing batch stock account");
      int changed=jdbc.update("UPDATE "+e.table()+" SET "+col+"=:to WHERE "+
        e.identityColumn()+"=:key AND "+col+"=:from",
        Map.of("key",id,"from",op.fromState(),"to",op.toState()));
      if(changed!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Batch already reversed");
      for(var entry:deltas.entrySet()){
        long delta=entry.getValue();
        if(delta==0L)continue;
        long minimum=delta<0?-delta:0L;
        long maximum=delta>0?reverse.maxBalance()-delta:reverse.maxBalance();
        if(minimum>reverse.maxBalance()||maximum<0)
          throw new ResponseStatusException(HttpStatus.CONFLICT,"Batch reversal exceeds balance limits");
        int moved=jdbc.update("UPDATE "+reverse.stockTable()+" SET "+
          reverse.availableColumn()+"="+reverse.availableColumn()+"+:delta WHERE "+
          reverse.stockKeyColumn()+"=:id AND "+reverse.availableColumn()+">=:min AND "+
          reverse.availableColumn()+"<=:max",
          new MapSqlParameterSource().addValue("id",entry.getKey())
            .addValue("delta",delta).addValue("min",minimum).addValue("max",maximum));
        if(moved!=1)
          throw new ResponseStatusException(HttpStatus.CONFLICT,"Cannot restore all batch balances");
      }
      // dispatch() adds the state audit before commit, in this same transaction.
      return row(e,id);
    }
    if(op.reverseUnits()!=null){
      var reverse=op.reverseUnits();
      // Read immutable movement metadata; lock parents first in deterministic order,
      // matching CREATE's lock order. Then perform guarded state CAS and two effects.
      var lookup=jdbc.queryForList("SELECT "+reverse.sourceColumn()+","+
          reverse.targetColumn()+","+reverse.amountColumn()+" FROM "+e.table()+
          " WHERE "+e.identityColumn()+"=:key",Map.of("key",id));
      if(lookup.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      String from=(String)lookup.get(0).get(reverse.sourceColumn());
      String to=(String)lookup.get(0).get(reverse.targetColumn());
      int units=((Number)lookup.get(0).get(reverse.amountColumn())).intValue();
      if(from.equals(to)||units<1)
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Invalid stored movement");
      var names=Map.of("source",from,"target",to);
      var rows=jdbc.queryForList("SELECT "+reverse.stockKeyColumn()+" FROM "+
          reverse.stockTable()+" WHERE "+reverse.stockKeyColumn()+
          " IN (:source,:target) ORDER BY "+reverse.stockKeyColumn()+
          " FOR UPDATE",names,String.class);
      if(rows.size()!=2)
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Transfer endpoint missing");
      int stateUpdated=jdbc.update("UPDATE "+e.table()+" SET "+col+"=:to WHERE "+
          e.identityColumn()+"=:key AND "+col+"=:from",
          Map.of("key",id,"from",op.fromState(),"to",op.toState()));
      if(stateUpdated!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Already reversed");
      var params=new MapSqlParameterSource().addValue("source",from).addValue("target",to)
          .addValue("units",units).addValue("maxAfter",reverse.maxBalance()-units);
      int debited=jdbc.update("UPDATE "+reverse.stockTable()+" SET "+
          reverse.availableColumn()+"="+reverse.availableColumn()+"-:units WHERE "+
          reverse.stockKeyColumn()+"=:target AND "+reverse.availableColumn()+">=:units",params);
      if(debited!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Destination stock no longer available");
      int credited=jdbc.update("UPDATE "+reverse.stockTable()+" SET "+
          reverse.availableColumn()+"="+reverse.availableColumn()+"+:units WHERE "+
          reverse.stockKeyColumn()+"=:source AND "+reverse.availableColumn()+"<=:maxAfter",params);
      if(credited!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Source capacity exceeded");
      // @Transactional dispatch writes state audit in the SAME transaction.
      return row(e,id);
    }
    if(op.exactReverse()!=null){
      var reverse=op.exactReverse();
      var before=jdbc.queryForList("SELECT "+reverse.referenceColumn()+
        " AS ledger_reference FROM "+e.table()+" WHERE "+e.identityColumn()+
        "=:key",Map.of("key",id));
      if(before.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
      requireConsistentExactLedger(reverse.balanceTable(),reverse.balanceKey(),
        (String)before.get(0).get("ledger_reference"));
      var rows=jdbc.queryForList("UPDATE "+e.table()+" SET "+col+"=:target WHERE "+
        e.identityColumn()+"=:key AND "+col+"=:source RETURNING "+
        reverse.referenceColumn()+", "+reverse.amountColumn(),
        Map.of("key",id,"source",op.fromState(),"target",op.toState()));
      if(rows.isEmpty()){
        row(e,id);
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Already reversed");
      }
      String wallet=(String)rows.get(0).get(reverse.referenceColumn());
      BigDecimal amount=(BigDecimal)rows.get(0).get(reverse.amountColumn());
      int credited=jdbc.update("UPDATE "+reverse.balanceTable()+" SET "+
        reverse.balanceColumn()+"="+reverse.balanceColumn()+"+:amount WHERE "+
        reverse.balanceKey()+"=:key AND "+reverse.balanceColumn()+"<=(:max-:amount)",
        Map.of("key",wallet,"amount",amount,"max",new BigDecimal(reverse.maxBalance())));
      if(credited!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Cannot restore exact balance");
      return row(e,id);
    }
    if (op.release()!=null) {
      var release=op.release();
      String referenceColumn=e.fields().stream().filter(f -> f.name().equals(release.referenceField()))
          .findFirst().orElseThrow().column();
      String amountColumn=e.fields().stream().filter(f -> f.name().equals(release.amountField()))
          .findFirst().orElseThrow().column();
      var rows=jdbc.queryForList("UPDATE "+e.table()+" SET "+col+"=:target WHERE "+
          e.identityColumn()+"=:key AND "+col+"=:source RETURNING "+
          referenceColumn+", "+amountColumn,
          Map.of("key",id,"source",op.fromState(),"target",op.toState()));
      if (rows.isEmpty()) {
        row(e,id);
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Reservation already processed");
      }
      String stock=(String)rows.get(0).get(referenceColumn);
      Number amount=(Number)rows.get(0).get(amountColumn);
      int credited=jdbc.update("UPDATE "+release.stockTable()+" SET "+
          release.availableColumn()+"="+release.availableColumn()+"+:amount WHERE "+
          release.stockKeyColumn()+"=:stock AND "+
          release.availableColumn()+"<=2147483647-:amount",
          Map.of("stock",stock,"amount",amount.intValue()));
      if (credited!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Cannot restore stock");
      return row(e,id);
    }
    int changed;
    try {
      changed = jdbc.update("UPDATE "+e.table()+" SET "+col+"=:target WHERE "+
          e.identityColumn()+"=:key AND "+col+"=:source",
          Map.of("key",id,"source",op.fromState(),"target",op.toState()));
    } catch (DataIntegrityViolationException ex) {
      if (constraintSqlState(ex,"23505"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Business key already active");
      throw ex;
    }
    if (changed == 0) {
      row(e,id);
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Transition precondition failed");
    }
    return row(e,id);
  }

  private Map<String,Object> increment(Manifest.Entity e, Manifest.Op op, String id, Map<String,Object> body) {
    if (body == null || body.size()!=1 || !body.containsKey(op.input()) || !(body.get(op.input()) instanceof Integer amount)
        || amount < op.inputMin() || amount > op.inputMax()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    String col = e.fields().stream().filter(f -> f.name().equals(op.field())).findFirst().orElseThrow().column();
    int changed = jdbc.update("UPDATE " + e.table() + " SET " + col + "=" + col + "+:amount WHERE " +
       e.identityColumn() + "=:key AND " + col + "<=2147483647-:amount",
       Map.of("key", id, "amount", amount));
    if (changed == 0) {
      row(e,id);
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Integer overflow");
    }
    return row(e,id);
  }
}
