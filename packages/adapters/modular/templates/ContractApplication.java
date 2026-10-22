package dev.protocolia.modular;

import org.flywaydb.core.Flyway;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.sql.PreparedStatement;

@SpringBootApplication
@EnableScheduling
public class ContractApplication {
  private static String handoff() {
    String value=System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_HANDOFF_ID","");
    if(!value.matches("[a-f0-9]{64}"))
      throw new IllegalStateException("Missing or invalid staged image migration handoff");
    return value;
  }
  private static void publishHandoff(String url,String user,String pass) throws Exception {
    String runtime=System.getenv().getOrDefault("PROTOCOLIA_HANDOFF_RUNTIME_USER","");
    if(!runtime.matches("[a-z][a-z0-9_]{1,62}"))
      throw new IllegalStateException("Invalid SQL runtime handoff principal");
    try(Connection connection=DriverManager.getConnection(url,user,pass)) {
      connection.setAutoCommit(false);
      try(Statement statement=connection.createStatement()) {
        statement.execute("CREATE TABLE IF NOT EXISTS public.protocolia_migration_handoff_v1 "+
          "(image_digest varchar(64) PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)");
        statement.execute("GRANT SELECT ON public.protocolia_migration_handoff_v1 TO "+runtime);
        try(PreparedStatement insert=connection.prepareStatement(
            "INSERT INTO public.protocolia_migration_handoff_v1 (image_digest) VALUES (?) "+
            "ON CONFLICT (image_digest) DO NOTHING")) {
          insert.setString(1,handoff());
          insert.executeUpdate();
        }
        connection.commit();
      } catch(Exception failure) {
        connection.rollback();
        throw failure;
      }
    }
    System.out.println("PROTOCOLIA_SPRING_MIGRATION_HANDOFF_PUBLISHED");
  }
  public static void main(String[] args) throws Exception {
    String mode=System.getenv().getOrDefault("PROTOCOLIA_EXECUTION_MODE", "legacy");
    if (!mode.equals("legacy") && !mode.equals("migrate") && !mode.equals("runtime"))
      throw new IllegalArgumentException("Unsupported ProtocolIA execution mode");
    if (mode.equals("migrate")) {
      if (System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_USER","").length()>0 ||
          System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_PASSWORD","").length()>0)
        throw new IllegalStateException("One-shot migrator accepts only its own JDBC identity");
      String jdbc=System.getenv("PROTOCOLIA_JDBC_URL");
      String user=System.getenv("PROTOCOLIA_JDBC_USER");
      String pass=System.getenv("PROTOCOLIA_JDBC_PASSWORD");
      if(jdbc==null||!jdbc.startsWith("jdbc:postgresql://")||user==null||user.isBlank()||
          pass==null||pass.isBlank())
        throw new IllegalStateException("Explicit one-shot PostgreSQL migration credentials required");
      String failpoint=System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_FAILPOINT","");
      if(!failpoint.equals("")&&!failpoint.equals("before-migrate")&&!failpoint.equals("after-migrate"))
        throw new IllegalStateException("Invalid one-shot migration fault injection");
      handoff();
      if(failpoint.equals("before-migrate"))
        throw new IllegalStateException("PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_BEFORE_COMMIT");
      Flyway flyway=Flyway.configure().dataSource(jdbc,user,pass)
        .locations("classpath:db/migration")
        .baselineOnMigrate(false).validateOnMigrate(true)
        .outOfOrder(false).cleanDisabled(true).load();
      flyway.migrate();
      if(failpoint.equals("after-migrate"))
        throw new IllegalStateException("PROTOCOLIA_TEST_MIGRATION_INTERRUPTED_AFTER_COMMIT");
      publishHandoff(jdbc,user,pass);
      System.out.println("PROTOCOLIA_SPRING_ONE_SHOT_MIGRATION_PASS");
      return;
    }
    if (mode.equals("runtime")) {
      if (!System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_USER","").isEmpty()||
          !System.getenv().getOrDefault("PROTOCOLIA_MIGRATION_JDBC_PASSWORD","").isEmpty())
        throw new IllegalStateException("Runtime container must not receive migration credentials");
      String jdbc=System.getenv("PROTOCOLIA_JDBC_URL");
      String user=System.getenv("PROTOCOLIA_JDBC_USER");
      String pass=System.getenv("PROTOCOLIA_JDBC_PASSWORD");
      if(jdbc==null||user==null||pass==null||user.isBlank()||pass.isBlank())
        throw new IllegalStateException("Runtime SQL credentials required");
      try(Connection connection=DriverManager.getConnection(jdbc,user,pass);
          Statement query=connection.createStatement();
          ResultSet row=query.executeQuery("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")) {
        if(!row.next()||row.getBoolean(1))
          throw new IllegalStateException("Runtime SQL principal must not be a superuser");
      }
      try(Connection connection=DriverManager.getConnection(jdbc,user,pass);
          PreparedStatement statement=connection.prepareStatement(
            "SELECT image_digest FROM public.protocolia_migration_handoff_v1 WHERE image_digest=?")) {
        statement.setString(1,handoff());
        try(ResultSet row=statement.executeQuery()) {
          if(!row.next()||row.next())
            throw new IllegalStateException("HTTP runtime refused incomplete migration handoff");
        }
      }
      System.setProperty("spring.flyway.enabled","false");
      System.out.println("PROTOCOLIA_SPRING_RUNTIME_WITHOUT_MIGRATOR_SECRET");
    }
    SpringApplication.run(ContractApplication.class,args);
  }
}
