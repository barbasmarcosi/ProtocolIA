package dev.protocolia.modular;

import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
  private static String required(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) throw new IllegalStateException("Missing test-only environment: " + key);
    return value;
  }
  @Bean
  UserDetailsService users() {
    if (!"true".equals(System.getenv("PROTOCOLIA_ALLOW_DEMO_AUTH")))
      throw new IllegalStateException("Demo Basic authentication requires explicit isolated profile opt-in");
    if(required("PROTOCOLIA_READER_USERNAME").equalsIgnoreCase(required("PROTOCOLIA_MANAGER_USERNAME")))
      throw new IllegalStateException("Demo subjects must be distinct");
    var encoder = new BCryptPasswordEncoder();
    var reader = User.withUsername(required("PROTOCOLIA_READER_USERNAME"))
        .password("{bcrypt}" + encoder.encode(required("PROTOCOLIA_READER_PASSWORD")))
        .authorities(Manifest.READ_CAPABILITIES.toArray(String[]::new)).build();
    var manager = User.withUsername(required("PROTOCOLIA_MANAGER_USERNAME"))
        .password("{bcrypt}" + encoder.encode(required("PROTOCOLIA_MANAGER_PASSWORD")))
        .authorities(java.util.stream.Stream.concat(
          java.util.stream.Stream.concat(Manifest.READ_CAPABILITIES.stream(),
              Manifest.WRITE_CAPABILITIES.stream()),
          java.util.stream.Stream.concat(Manifest.AUDIT_CAPABILITIES.stream(),
              java.util.stream.Stream.concat(Manifest.ASSIGN_CAPABILITIES.stream(),
                Manifest.FIELD_READ_CAPABILITIES.stream()))).distinct().toArray(String[]::new)).build();
    var users=new InMemoryUserDetailsManager(reader,manager);
    var keys=java.util.List.of("PROTOCOLIA_SCOPED_USERNAME","PROTOCOLIA_SCOPED_PASSWORD",
        "PROTOCOLIA_SCOPED_CAPABILITIES");
    boolean configured=keys.stream().anyMatch(k->System.getenv(k)!=null&&!System.getenv(k).isBlank());
    if(configured){
      for(var key:keys)required(key);
      String scopedUsername=required("PROTOCOLIA_SCOPED_USERNAME");
      String scopedPassword=required("PROTOCOLIA_SCOPED_PASSWORD");
      if(scopedPassword.length()<16||scopedUsername.equalsIgnoreCase(reader.getUsername())||
          scopedUsername.equalsIgnoreCase(manager.getUsername()))
        throw new IllegalStateException("Unsafe scoped test credential");
      var capabilities=java.util.Arrays.stream(required("PROTOCOLIA_SCOPED_CAPABILITIES").split(",",-1))
          .map(String::trim).toList();
      var allowed=java.util.stream.Stream.of(Manifest.READ_CAPABILITIES,
          Manifest.WRITE_CAPABILITIES,Manifest.AUDIT_CAPABILITIES,
          Manifest.ASSIGN_CAPABILITIES,Manifest.FIELD_READ_CAPABILITIES)
          .flatMap(java.util.List::stream).collect(java.util.stream.Collectors.toSet());
      if(capabilities.size()>16||new java.util.HashSet<>(capabilities).size()!=capabilities.size()||
          capabilities.stream().anyMatch(c->c.equals("public")||!allowed.contains(c)))
        throw new IllegalStateException("Invalid scoped test authority allowlist");
      users.createUser(User.withUsername(scopedUsername)
          .password("{bcrypt}"+encoder.encode(scopedPassword))
          .authorities(capabilities.toArray(String[]::new)).build());
    }
    return users;
  }
  @Bean
  SecurityFilterChain security(HttpSecurity http) throws Exception {
    http.csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(a -> a.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            .requestMatchers("/health", "/", "/index.html", "/protocolia-ui.json", "/assets/**").permitAll()
            .requestMatchers("/api/**").authenticated()
            .anyRequest().denyAll())
        .httpBasic(Customizer.withDefaults());
    return http.build();
  }
}
