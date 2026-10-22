package dev.protocolia.modular;

import org.flywaydb.core.Flyway;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

@SpringBootApplication
@EnableScheduling
public class ContractApplication {
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
      Flyway flyway=Flyway.configure().dataSource(jdbc,user,pass)
        .locations("classpath:db/migration")
        .baselineOnMigrate(false).validateOnMigrate(true)
        .outOfOrder(false).cleanDisabled(true).load();
      flyway.migrate();
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
      System.setProperty("spring.flyway.enabled","false");
      System.out.println("PROTOCOLIA_SPRING_RUNTIME_WITHOUT_MIGRATOR_SECRET");
    }
    SpringApplication.run(ContractApplication.class,args);
  }
}
