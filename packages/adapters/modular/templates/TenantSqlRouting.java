package dev.protocolia.modular;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.datasource.lookup.AbstractRoutingDataSource;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

// P2 RLS-S1 experimental. Exactly two reviewed orgs and a 7-op v0.7 graph.
// The transaction interceptor requests a connection after Spring Security
// established a trusted authentication; no request header can select a role.
@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="PROTOCOLIA_TENANT_SQL_ROUTING",havingValue="alpha-beta-v1")
public class TenantSqlRouting {
  private static String required(String key) {
    String value=System.getenv(key);
    if(value==null||value.isBlank())throw new IllegalStateException(
      "Missing SQL routing configuration: "+key);
    return value;
  }
  private static boolean reviewedGraph() {
    if(Manifest.ENTITIES.size()!=1||Manifest.OPS.size()!=7)return false;
    var name=Manifest.ENTITIES.get(0).name().toLowerCase(java.util.Locale.ROOT);
    return Manifest.OPS.stream().anyMatch(op->op.kind().equals("create")&&
      op.capability().equals(name+".write.tenant"))&&
      Manifest.OPS.stream().filter(op->op.kind().equals("transition")&&
        op.capability().equals(name+".decide.checked")).count()==2;
  }
  private static HikariDataSource pool(String jdbc,String role,String password) {
    HikariConfig config=new HikariConfig();
    config.setJdbcUrl(jdbc);
    config.setUsername(role);
    config.setPassword(password);
    config.setMaximumPoolSize(8);
    config.setMinimumIdle(0);
    config.setPoolName("protocolia-tenant-"+role);
    return new HikariDataSource(config);
  }
  private static void preflight(DataSource source,String role,String tenant,String table) {
    try(Connection c=source.getConnection();Statement s=c.createStatement();
        ResultSet rs=s.executeQuery("SELECT session_user,current_user,"+
          "public.protocolia_rls_session_tenant() AS tenant,"+
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
          "WHERE r.rolname=current_user) AS member")) {
      if(!rs.next()||!role.equals(rs.getString("session_user"))||
         !role.equals(rs.getString("current_user"))||
         !tenant.equals(rs.getString("tenant"))||
         !rs.getBoolean("entity_rls")||rs.wasNull()||
         !rs.getBoolean("audit_rls")||rs.wasNull()||
         rs.getBoolean("can_create")||rs.getBoolean("can_delete")||
         rs.getBoolean("audit_read")||rs.getBoolean("privileged")||
         rs.getBoolean("member"))
        throw new IllegalStateException("Tenant SQL role/RLS preflight mismatch");
      if(rs.next())throw new IllegalStateException("Unexpected tenant SQL identity rows");
    }catch(Exception error){
      throw new IllegalStateException("Tenant SQL routing refused unsafe DB identity",error);
    }
  }

  @Bean(name="dataSource",destroyMethod="close")
  @Primary
  public DataSource dataSource() {
    if(!reviewedGraph()||
       !"runtime".equals(System.getenv("PROTOCOLIA_EXECUTION_MODE"))||
       "true".equals(System.getenv("PROTOCOLIA_BFF_ENABLED"))||
       "true".equals(System.getenv("PROTOCOLIA_ALERT_WORKER_ENABLED"))||
       "true".equals(System.getenv("PROTOCOLIA_PROVIDER_SANDBOX_ENABLED"))||
       !System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_USER","").isEmpty()||
       !System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_PASSWORD","").isEmpty())
      throw new IllegalStateException("Tenant SQL routing requires isolated v0.7 HTTP runtime only");
    String jdbc=required("PROTOCOLIA_JDBC_URL");
    if(!jdbc.startsWith("jdbc:postgresql://"))
      throw new IllegalStateException("PostgreSQL URL required for tenant SQL routing");
    String alphaUser=required("PROTOCOLIA_TENANT_SQL_ALPHA_USER");
    String betaUser=required("PROTOCOLIA_TENANT_SQL_BETA_USER");
    String alphaPass=required("PROTOCOLIA_TENANT_SQL_ALPHA_PASSWORD");
    String betaPass=required("PROTOCOLIA_TENANT_SQL_BETA_PASSWORD");
    if(!alphaUser.matches("[a-z][a-z0-9_]{1,62}")||
       !betaUser.matches("[a-z][a-z0-9_]{1,62}")||
       alphaUser.equals(betaUser)||alphaPass.length()<16||betaPass.length()<16||
       !alphaUser.equals(required("PROTOCOLIA_JDBC_USER"))||
       !alphaPass.equals(required("PROTOCOLIA_JDBC_PASSWORD")))
      throw new IllegalStateException("Invalid tenant SQL login configuration");
    HikariDataSource alpha=pool(jdbc,alphaUser,alphaPass);
    HikariDataSource beta=pool(jdbc,betaUser,betaPass);
    try{
      String table=Manifest.ENTITIES.get(0).table();
      if(!table.matches("[a-z][a-z0-9_]{0,50}"))
        throw new IllegalStateException("Unreviewed tenant table");
      preflight(alpha,alphaUser,"org_alpha",table);
      preflight(beta,betaUser,"org_beta",table);
      Map<Object,Object> sources=new LinkedHashMap<>();
      sources.put("org_alpha",alpha);
      sources.put("org_beta",beta);
      var router=new AbstractRoutingDataSource(){
        @Override protected Object determineCurrentLookupKey(){
          Authentication auth=SecurityContextHolder.getContext().getAuthentication();
          if(auth==null||!auth.isAuthenticated())
            throw new IllegalStateException("Tenant SQL routing without authentication");
          String tenant=DomainRuntime.verifiedTenant(auth);
          if(!sources.containsKey(tenant))
            throw new IllegalStateException("Tenant SQL route not provisioned");
          return tenant;
        }
      };
      router.setTargetDataSources(sources);
      router.setLenientFallback(false);
      router.afterPropertiesSet();
      System.out.println("PROTOCOLIA_SPRING_TENANT_SQL_ROUTING_READY");
      return router;
    }catch(RuntimeException error){
      alpha.close();beta.close();throw error;
    }
  }
}
