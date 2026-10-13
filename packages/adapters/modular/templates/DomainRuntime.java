package dev.protocolia.modular;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLDecoder;
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
    Manifest.Entity entity = Manifest.ENTITIES.stream().filter(e -> e.name().equals(matched.entity())).findFirst()
        .orElseThrow(() -> new IllegalStateException("Unresolved entity in generated manifest"));
    Object result;
    switch (matched.kind()) {
      case "create" -> result = create(entity, body);
      case "get" -> result = row(entity, publicKey);
      case "listPage" -> result = page(entity, query, matched);
      case "patchFields" -> result = patch(entity, matched, publicKey, body);
      case "atomicIncrement" -> result = increment(entity, matched, publicKey, body);
      default -> throw new IllegalStateException("Unsupported generated behavior");
    }
    int status = matched.kind().equals("create") ? 201 : 200;
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
      for (var f : e.fields()) if (f.required() && !body.containsKey(f.name())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Missing required input");
    }
    for (var input : body.entrySet()) {
      var f = e.fields().stream().filter(x -> x.name().equals(input.getKey())).findFirst()
          .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown field"));
      Object v = input.getValue();
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

  private Map<String,Object> create(Manifest.Entity e, Map<String,Object> body) {
    Set<String> fields = e.fields().stream().map(Manifest.Field::name).collect(java.util.stream.Collectors.toSet());
    validate(e, body, true, fields);
    var params = new MapSqlParameterSource();
    for (var f : e.fields()) params.addValue(f.name(), sqlValue(f, body.get(f.name())));
    String names = e.fields().stream().map(Manifest.Field::column).reduce((a,b)->a+","+b).orElseThrow();
    String values = e.fields().stream().map(f -> ":" + f.name()).reduce((a,b)->a+","+b).orElseThrow();
    try {
      jdbc.update("INSERT INTO " + e.table() + " (" + names + ") VALUES (" + values + ")", params);
    } catch (DuplicateKeyException ex) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Duplicate public identity");
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

  private Map<String,Object> patch(Manifest.Entity e, Manifest.Op op, String id, Map<String,Object> body) {
    validate(e, body, false, Set.of(op.field()));
    if (!body.containsKey(op.input())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
    String col = e.fields().stream().filter(f -> f.name().equals(op.field())).findFirst().orElseThrow().column();
    var params = Map.<String,Object>of("key", id, "value", body.get(op.input()));
    int changed = jdbc.update("UPDATE " + e.table() + " SET " + col + "=:value WHERE " + e.identityColumn() + "=:key", params);
    if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    return row(e, id);
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
