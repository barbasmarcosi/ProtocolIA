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
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class DomainRuntime {
  private final NamedParameterJdbcTemplate jdbc;
  public DomainRuntime(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

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
    for (var op : Manifest.OPS) {
      if (!op.method().equals(request.getMethod())) continue;
      String pattern = op.path().replaceAll("\\{[A-Za-z][A-Za-z0-9_]*\\}", "([^/]+)");
      Matcher matcher = Pattern.compile("^" + pattern + "$").matcher(request.getRequestURI());
      if (matcher.matches()) {
        matched = op;
        if (matcher.groupCount() > 0) publicKey = URLDecoder.decode(matcher.group(1), StandardCharsets.UTF_8);
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
    if (matched.kind().equals("reconcileExact")) {
      var plan=Manifest.EXACT_RECONCILIATIONS.get(matched.name());
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
      case "create" -> result = create(entity, matched, body, user);
      case "get" -> result = row(entity, publicKey, user.getName());
      case "sumRelated" -> result = sumRelated(matched,publicKey);
      case "reconcileExact" -> result = reconcileExact(matched,publicKey);
      case "listPage" -> result = page(entity, query, matched, user.getName());
      case "queryPage" -> result = queryPage(entity, query, matched);
      case "inboxPage", "ackNotification" -> result = inbox(entity, matched, publicKey, query, body, user, request);
      case "auditPage" -> result = auditPage(entity, publicKey, query, matched);
      case "patchFields" -> result = patch(entity, matched, publicKey, body, user.getName());
      case "atomicIncrement" -> result = increment(entity, matched, publicKey, body);
      case "transition" -> result = transition(entity, matched, publicKey, body);
      case "reassignReference" -> result = reassignReference(entity, matched, publicKey, body);
      case "delete" -> result = delete(entity, publicKey);
      default -> throw new IllegalStateException("Unsupported generated behavior");
    }
    if(!matched.audit().isEmpty()){
      if(user==null || !user.isAuthenticated())
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
      @SuppressWarnings("unchecked")
      var updated=(Map<String,Object>)result;
      String id=String.valueOf(updated.get(entity.identity()));
      for(String field:matched.audit()){
        Object after=updated.get(field);
        String before=matched.kind().equals("transition")?matched.fromState():
            matched.kind().equals("reassignReference")?String.valueOf(body.get("expected")):null;
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
      }else if(Set.of("create","get","patchFields").contains(matched.kind())){
        var record=new LinkedHashMap<String,Object>();
        raw.forEach((key,val)->record.put(String.valueOf(key),val));
        sensitive.forEach(record::remove);
        result=record;
      }
    }
    int status = matched.kind().equals("create") ? 201 : matched.kind().equals("delete") ? 204 : 200;
    return ResponseEntity.status(status).body(result);
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

  private Map<String,Object> reconcileExact(Manifest.Op op,String id){
    if(id==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var plan=Manifest.EXACT_RECONCILIATIONS.get(op.name());
    if(plan==null)throw new IllegalStateException("Missing exact reconciliation plan");
    var result=jdbc.queryForList(plan.sql(),Map.of("identity",id));
    if(result.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return result.get(0);
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

  private Map<String,Object> create(Manifest.Entity e, Manifest.Op op, Map<String,Object> body, Authentication user) {
    String subject=user.getName();
    if(e.ownerField()!=null){
      if(body==null||body.containsKey(e.ownerField()))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Owner field cannot be supplied");
      body=new java.util.LinkedHashMap<>(body);
      body.put(e.ownerField(),subject);
    }
    Set<String> fields = e.fields().stream().filter(f -> !f.computed()).map(Manifest.Field::name).collect(java.util.stream.Collectors.toSet());
    validate(e, body, true, fields);
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

  private Map<String,Object> patch(Manifest.Entity e, Manifest.Op op, String id, Map<String,Object> body, String subject) {
    validate(e, body, false, Set.of(op.field()));
    if (!body.containsKey(op.input())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    String col = e.fields().stream().filter(f -> f.name().equals(op.field())).findFirst().orElseThrow().column();
    if(e.ownerField()!=null&&(subject==null||e.ownerField().equals(op.field())))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    var params=new MapSqlParameterSource().addValue("key",id).addValue("value",body.get(op.input()));
    if(e.ownerField()!=null)params.addValue("owner",subject);
    String guard=e.ownerField()==null?"":" AND "+e.ownerColumn()+"=:owner";
    int changed;
    try {
      // PostgreSQL enforces composite uniqueness atomically against concurrent writers.
      changed=jdbc.update("UPDATE "+e.table()+" SET "+col+"=:value WHERE "+e.identityColumn()+"=:key"+guard,params);
    } catch (DataIntegrityViolationException ex) {
      if(constraintSqlState(ex,"23505"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Compound business key already exists",ex);
      if(constraintSqlState(ex,"23514")||constraintSqlState(ex,"23502"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Constraint violation",ex);
      throw ex;
    }
    if(changed==0)throw new ResponseStatusException(HttpStatus.NOT_FOUND);
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

  private Object delete(Manifest.Entity e, String id) {
    if (id == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    int affected;
    try {
      affected = jdbc.update("DELETE FROM "+e.table()+" WHERE "+e.identityColumn()+"=:key", Map.of("key",id));
    } catch (DataIntegrityViolationException ex) {
      if (constraintSqlState(ex,"23503"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Referenced by another resource");
      throw ex;
    }
    if (affected == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return null;
  }

  private Map<String,Object> transition(Manifest.Entity e, Manifest.Op op, String id, Map<String,Object> body) {
    if (id == null || (body != null && !body.isEmpty()))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Transition does not accept input");
    String col = e.fields().stream().filter(f -> f.name().equals(op.field())).findFirst().orElseThrow().column();
    if(op.exactReverse()!=null){
      var reverse=op.exactReverse();
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
    int changed = jdbc.update("UPDATE "+e.table()+" SET "+col+"=:target WHERE "+
        e.identityColumn()+"=:key AND "+col+"=:source",
        Map.of("key",id,"source",op.fromState(),"target",op.toState()));
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
