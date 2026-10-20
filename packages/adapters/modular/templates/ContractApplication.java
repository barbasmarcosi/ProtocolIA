package dev.protocolia.modular;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ContractApplication {
  public static void main(String[] args) { SpringApplication.run(ContractApplication.class, args); }
}
