package dev.protocolia.modular;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.datasource.lookup.AbstractRoutingDataSource;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

// P2 S2.1: operator-bound JWT subject+tenant -> authenticated per-human SQL LOGIN.
// No endpoint/body/header controls the SQL role. This is an opt-in, bounded
// four-human profile; arbitrary users, workers and tenant pool fallbacks fail.
@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="PROTOCOLIA_TENANT_SQL_ROUTING",havingValue="human-jwt-v1")
public class HumanSqlRouting {
  private final List<HikariDataSource> pools=new ArrayList<>();
  // Published only after all four SQL principals pass startup preflight.
  // Spring Security checks this before @Transactional can acquire JDBC.
  private volatile Set<String> authorizedJwtHumans=Set.of();

  boolean permitsVerifiedJwtHuman(Authentication auth){
    if(!(auth instanceof org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken jwt)||
       !jwt.isAuthenticated())return false;
    String tenant=jwt.getToken().getClaimAsString("protocolia_tenant");
    String subject=jwt.getName();
    return tenant!=null&&subject!=null&&
      authorizedJwtHumans.contains(tenant+"|"+subject);
  }

  @jakarta.annotation.PreDestroy
  public void closePools(){
    authorizedJwtHumans=Set.of();
    for(HikariDataSource pool:pools)pool.close();
    pools.clear();
  }
  private static String required(String key){
    String value=System.getenv(key);
    if(value==null||value.isBlank())
      throw new IllegalStateException("Missing operator-managed S2 SQL configuration: "+key);
    return value;
  }
  private static boolean reviewedGraph(){
    if(Manifest.ENTITIES.size()!=1||Manifest.OPS.size()!=6)return false;
    String name=Manifest.ENTITIES.get(0).name().toLowerCase(java.util.Locale.ROOT);
    return Manifest.OPS.stream().anyMatch(o->o.kind().equals("create")&&
      o.capability().equals(name+".write.tenant"))&&
      Manifest.OPS.stream().filter(o->o.kind().equals("transition")&&
        o.capability().equals(name+".decide.checked")).count()==2;
  }
  private static String stringField(JsonNode node,String name){
    JsonNode value=node.path(name);
    if(!value.isTextual())throw new IllegalStateException("Missing S2 SQL binding field: "+name);
    return value.textValue();
  }
  private static HikariDataSource pool(String url,String user,String password){
    HikariConfig cfg=new HikariConfig();
    cfg.setJdbcUrl(url);cfg.setUsername(user);cfg.setPassword(password);
    cfg.setMaximumPoolSize(5);cfg.setMinimumIdle(0);
    cfg.setPoolName("protocolia-human-"+user);
    return new HikariDataSource(cfg);
  }
  private static void preflight(DataSource ds,String user,String tenant,String subject,String table){
    try(Connection connection=ds.getConnection();Statement statement=connection.createStatement();
        ResultSet row=statement.executeQuery("SELECT session_user,current_user,"+
          "public.protocolia_rls_session_tenant() AS tenant,"+
          "public.protocolia_s2_session_subject() AS human,"+
          "EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid "+
          "JOIN pg_class c ON c.oid=t.tgrelid "+
          "WHERE c.oid='public."+table+"'::regclass "+
          "AND t.tgname='protocolia_s2_human_"+table+"_trigger' "+
          "AND t.tgenabled IN ('O','A') AND t.tgtype=19 "+
          "AND t.tgqual IS NULL AND NOT t.tgisinternal "+
          "AND p.proname='protocolia_s2_human_"+table+"_guard' "+
          "AND p.proowner=c.relowner AND p.pronamespace='public'::regnamespace) AS human_guard,"+
          "EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid "+
          "JOIN pg_class c ON c.oid=t.tgrelid "+
          "WHERE c.oid='public.protocolia_audit_event'::regclass "+
          "AND t.tgname='protocolia_s2_audit_actor_trigger' "+
          "AND t.tgenabled IN ('O','A') AND t.tgtype=7 "+
          "AND t.tgqual IS NULL AND NOT t.tgisinternal "+
          "AND p.proname='protocolia_s2_audit_actor_guard' "+
          "AND p.proowner=c.relowner AND p.pronamespace='public'::regnamespace) AS audit_guard,"+
          "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
          "WHERE oid='public."+table+"'::regclass) AS entity_rls,"+
          "(SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "+
          "WHERE oid='public.protocolia_audit_event'::regclass) AS audit_rls,"+
          "has_schema_privilege(current_user,'public','CREATE') AS can_create,"+
          "has_table_privilege(current_user,'public."+table+"','DELETE') AS can_delete,"+
          "has_table_privilege(current_user,'public.protocolia_audit_event','SELECT') AS audit_read,"+
          "(SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication "+
          "FROM pg_roles WHERE rolname=current_user) AS privileged,"+
          "EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member "+
          "WHERE r.rolname=current_user) AS member")){
      if(!row.next()||!user.equals(row.getString("session_user"))||
         !user.equals(row.getString("current_user"))||
         !tenant.equals(row.getString("tenant"))||
         !subject.equals(row.getString("human"))||
         !row.getBoolean("entity_rls")||row.wasNull()||
         !row.getBoolean("audit_rls")||row.wasNull()||
         !row.getBoolean("human_guard")||row.wasNull()||
         !row.getBoolean("audit_guard")||row.wasNull()||
         row.getBoolean("can_create")||row.getBoolean("can_delete")||
         row.getBoolean("audit_read")||row.getBoolean("privileged")||
         row.getBoolean("member")||row.next())
        throw new IllegalStateException("S2 SQL human principal/tenant/RLS mismatch");
    }catch(Exception e){
      throw new IllegalStateException("S2 human SQL routing refused unsafe DB identity",e);
    }
  }
  @Bean(name="dataSource")
  @Primary
  public DataSource dataSource(){
    if(!reviewedGraph()||
       !"runtime".equals(System.getenv("PROTOCOLIA_EXECUTION_MODE"))||
       !"jwt".equals(System.getenv("PROTOCOLIA_AUTH_MODE"))||
       "true".equals(System.getenv("PROTOCOLIA_ALLOW_DEMO_AUTH"))||
       "true".equals(System.getenv("PROTOCOLIA_BFF_ENABLED"))||
       "true".equals(System.getenv("PROTOCOLIA_ALERT_WORKER_ENABLED"))||
       "true".equals(System.getenv("PROTOCOLIA_PROVIDER_SANDBOX_ENABLED"))||
       !System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_USER","").isEmpty()||
       !System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_PASSWORD","").isEmpty()||
       !System.getenv().getOrDefault("PROTOCOLIA_TENANT_SQL_ALPHA_USER","").isEmpty()||
       !System.getenv().getOrDefault("PROTOCOLIA_TENANT_SQL_BETA_USER","").isEmpty())
      throw new IllegalStateException("S2 human SQL routing requires isolated reviewed JWT runtime");
    String jdbc=required("PROTOCOLIA_JDBC_URL");
    if(!jdbc.startsWith("jdbc:postgresql://"))
      throw new IllegalStateException("S2 requires explicit PostgreSQL JDBC URL");
    JsonNode bindings;
    try{bindings=new ObjectMapper().readTree(required("PROTOCOLIA_S2_HUMAN_SQL_BINDINGS_JSON"));}
    catch(Exception e){throw new IllegalStateException("Invalid S2 human binding JSON",e);}
    if(!bindings.isArray()||bindings.size()!=4)
      throw new IllegalStateException("S2 requires four independently bound human SQL logins");
    String baseUser=required("PROTOCOLIA_JDBC_USER");
    String basePassword=required("PROTOCOLIA_JDBC_PASSWORD");
    Map<Object,Object> targets=new LinkedHashMap<>();
    Map<String,Integer> counts=new HashMap<>();
    Set<String> usernames=new HashSet<>();
    int baseCount=0;
    try{
      for(JsonNode entry:bindings){
        if(!entry.isObject()||entry.size()!=4)
          throw new IllegalStateException("Unreviewed S2 binding fields");
        String tenant=stringField(entry,"tenant");
        String subject=stringField(entry,"subject");
        String user=stringField(entry,"user");
        String password=stringField(entry,"password");
        if(!List.of("org_alpha","org_beta").contains(tenant)||
           !subject.matches("[A-Za-z0-9][A-Za-z0-9_.-]{1,127}")||
           !user.matches("[a-z][a-z0-9_]{1,62}")||password.length()<16||
           !usernames.add(user))
          throw new IllegalStateException("Unsafe S2 SQL role or verified subject mapping");
        String key=tenant+"|"+subject;
        if(targets.containsKey(key))
          throw new IllegalStateException("Duplicate S2 human route");
        if(user.equals(baseUser)){
          if(!password.equals(basePassword))
            throw new IllegalStateException("S2 base credential does not match mapped human");
          baseCount++;
        }
        counts.merge(tenant,1,Integer::sum);
        HikariDataSource ds=pool(jdbc,user,password);
        pools.add(ds);
        String table=Manifest.ENTITIES.get(0).table();
        if(!table.matches("[a-z][a-z0-9_]{0,50}"))
          throw new IllegalStateException("Unreviewed S2 business table");
        preflight(ds,user,tenant,subject,table);
        targets.put(key,ds);
      }
      if(baseCount!=1||!Integer.valueOf(2).equals(counts.get("org_alpha"))||
         !Integer.valueOf(2).equals(counts.get("org_beta")))
        throw new IllegalStateException("S2 needs two human principals in each tenant");
      AbstractRoutingDataSource routing=new AbstractRoutingDataSource(){
        @Override protected Object determineCurrentLookupKey(){
          Authentication auth=SecurityContextHolder.getContext().getAuthentication();
          if(!(auth instanceof org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken)||
             !auth.isAuthenticated())
            throw new IllegalStateException("S2 requires authenticated signed JWT human");
          String tenant=DomainRuntime.verifiedTenant(auth);
          String subject=auth.getName();
          String key=tenant+"|"+subject;
          if(!targets.containsKey(key))
            throw new IllegalStateException("No S2 SQL role for authenticated JWT human");
          return key;
        }
      };
      routing.setTargetDataSources(targets);
      routing.setLenientFallback(false);
      routing.afterPropertiesSet();
      authorizedJwtHumans=Set.copyOf(targets.keySet().stream()
        .map(String::valueOf).toList());
      System.out.println("PROTOCOLIA_SPRING_S2_HUMAN_SQL_ROUTING_READY");
      return routing;
    }catch(RuntimeException ex){
      closePools();
      throw ex;
    }
  }
}
