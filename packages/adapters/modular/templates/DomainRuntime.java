package dev.protocolia.modular;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLDecoder;
import java.sql.SQLException;
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
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class DomainRuntime {
  private final NamedParameterJdbcTemplate jdbc;
  public DomainRuntime(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

  @GetMapping("/health")
  public Map<String, String> health() { return Map.of("status", "UP"); }

  // Platform-authenticated capability discovery; only server authorities are trusted.
  @GetMapping("/api/_protocolia/me")
  public Map<String, Object> session(Authentication user) {
    if (user == null || !user.isAuthenticated())
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    return Map.of("username", user.getName(),
      "capabilities", user.getAuthorities().stream().map(a -> a.getAuthority()).sorted().toList());
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
    if (matched.reserve()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.reserve().stockWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if (matched.release()!=null && (user==null || user.getAuthorities().stream()
        .noneMatch(a -> a.getAuthority().equals(authorized.release().stockWriteCapability()))))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    Manifest.Entity entity = Manifest.ENTITIES.stream().filter(e -> e.name().equals(authorized.entity())).findFirst()
        .orElseThrow(() -> new IllegalStateException("Unresolved entity in generated manifest"));
    Object result;
    switch (matched.kind()) {
      case "create" -> result = create(entity, matched, body);
      case "get" -> result = row(entity, publicKey);
      case "listPage" -> result = page(entity, query, matched);
      case "auditPage" -> result = auditPage(entity, publicKey, query, matched);
      case "patchFields" -> result = patch(entity, matched, publicKey, body);
      case "atomicIncrement" -> result = increment(entity, matched, publicKey, body);
      case "transition" -> result = transition(entity, matched, publicKey, body);
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
        String before=matched.kind().equals("transition")?matched.fromState():null;
        jdbc.update("INSERT INTO protocolia_audit_event "+
          "(actor,entity_name,resource_id,operation_name,field_name,before_value,after_value) "+
          "VALUES (:actor,:entity,:id,:op,:field,:before,:after)",
          new MapSqlParameterSource().addValue("actor",user.getName())
          .addValue("entity",entity.name()).addValue("id",id)
          .addValue("op",matched.name()).addValue("field",field)
          .addValue("before",before).addValue("after",after==null?null:String.valueOf(after)));
      }
    }
    int status = matched.kind().equals("create") ? 201 : matched.kind().equals("delete") ? 204 : 200;
    return ResponseEntity.status(status).body(result);
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
      if (f.type().equals("utcDateTime") && value instanceof Timestamp ts) converted.put(f.name(), ts.toInstant().toString());
      else if (f.type().equals("utcDateTime") && value instanceof OffsetDateTime odt) converted.put(f.name(), odt.toInstant().toString());
    }
    return converted;
  }

  private Map<String,Object> row(Manifest.Entity e, String id) {
    if (id == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    try {
      return serialized(jdbc.queryForMap(
          selectSql(e) + " WHERE " + e.identityColumn() + " = :key",
          Map.of("key", id)), e);
    } catch (EmptyResultDataAccessException ex) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
  }

  private void validate(Manifest.Entity e, Map<String,Object> body, boolean create, Set<String> writable) {
    if (body == null || !writable.containsAll(body.keySet())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown input property");
    if (create) {
      for (var f : e.fields()) if (f.required() && !body.containsKey(f.name()) && f.initial()==null)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing required input");
    }
    for (var input : body.entrySet()) {
      var f = e.fields().stream().filter(x -> x.name().equals(input.getKey())).findFirst()
          .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown field"));
      Object v = input.getValue();
      if (create && f.initial() != null && !f.initial().equals(v))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only the initial state can be created");
      if (v == null) {
        if (!f.nullable()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Null is not allowed");
        continue;
      }
      if (f.type().equals("string")) {
        if (!(v instanceof String s) || s.isBlank() ||
            (f.minLength()!=null && s.length() < f.minLength()) ||
            (f.maxLength()!=null && s.length() > f.maxLength()))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid string field");
      } else if (f.type().equals("int32")) {
        if (!(v instanceof Integer n) || (f.min()!=null && n < f.min()) || (f.max()!=null && n > f.max()))
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid integer field");
      } else if (f.type().equals("utcDateTime")) {
        if (!(v instanceof String s)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        try { OffsetDateTime.parse(s); } catch (RuntimeException ex) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid datetime"); }
      } else {
        throw new IllegalStateException("Unsupported field type");
      }
    }
  }

  private Object sqlValue(Manifest.Field f, Object v) {
    if (v instanceof String s && f.type().equals("utcDateTime")) return OffsetDateTime.parse(s);
    return v;
  }

  private boolean constraintSqlState(Throwable error, String state) {
    for (Throwable cause=error;cause!=null;cause=cause.getCause())
      if (cause instanceof SQLException sql && state.equals(sql.getSQLState())) return true;
    return false;
  }

  private Map<String,Object> create(Manifest.Entity e, Manifest.Op op, Map<String,Object> body) {
    Set<String> fields = e.fields().stream().map(Manifest.Field::name).collect(java.util.stream.Collectors.toSet());
    validate(e, body, true, fields);
    body = new java.util.LinkedHashMap<>(body);
    for (var f : e.fields()) if (f.initial()!=null && !body.containsKey(f.name()))
      body.put(f.name(),f.initial());
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
    var params = new MapSqlParameterSource();
    for (var f : e.fields()) params.addValue(f.name(), sqlValue(f, body.get(f.name())));
    String names = e.fields().stream().map(Manifest.Field::column).reduce((a,b)->a+","+b).orElseThrow();
    String values = e.fields().stream().map(f -> ":" + f.name()).reduce((a,b)->a+","+b).orElseThrow();
    try {
      jdbc.update("INSERT INTO " + e.table() + " (" + names + ") VALUES (" + values + ")", params);
    } catch (DataIntegrityViolationException ex) {
      if (constraintSqlState(ex,"23503"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Referenced resource does not exist");
      if (constraintSqlState(ex,"23505"))
        throw new ResponseStatusException(HttpStatus.CONFLICT,"Duplicate unique value");
      if (constraintSqlState(ex,"23502") || constraintSqlState(ex,"23514"))
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Database constraint violation");
      throw ex;
    }
    return row(e, (String) body.get(e.identity()));
  }

  private Map<String,Object> page(Manifest.Entity e, Map<String,String> query, Manifest.Op op) {
    if (!query.keySet().stream().allMatch(k -> k.equals("limit") || k.equals("offset")))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    int limit, offset;
    try {
      limit = Integer.parseInt(query.getOrDefault("limit", String.valueOf(op.limitDefault())));
      offset = Integer.parseInt(query.getOrDefault("offset", String.valueOf(op.offsetDefault())));
    } catch (NumberFormatException ex) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST); }
    if (limit < op.limitMin() || limit > op.limitMax() || offset < 0 || offset > op.offsetMax())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    var args = Map.<String,Object>of("limit", limit, "offset", offset);
    var result = jdbc.queryForList(selectSql(e) + " ORDER BY " + e.identityColumn() + " LIMIT :limit OFFSET :offset", args);
    List<Map<String,Object>> items = result.stream().map(r -> serialized(r, e)).toList();
    Number count = jdbc.queryForObject("SELECT COUNT(*) FROM " + e.table(), new MapSqlParameterSource(), Number.class);
    return Map.of("items", items, "total", count.intValue(), "limit", limit, "offset", offset);
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

  private Map<String,Object> patch(Manifest.Entity e, Manifest.Op op, String id, Map<String,Object> body) {
    validate(e, body, false, Set.of(op.field()));
    if (!body.containsKey(op.input())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    String col = e.fields().stream().filter(f -> f.name().equals(op.field())).findFirst().orElseThrow().column();
    var params = Map.<String,Object>of("key", id, "value", body.get(op.input()));
    int changed = jdbc.update("UPDATE " + e.table() + " SET " + col + "=:value WHERE " + e.identityColumn() + "=:key", params);
    if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return row(e, id);
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
