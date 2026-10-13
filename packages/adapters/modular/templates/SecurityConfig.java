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
    var encoder = new BCryptPasswordEncoder();
    var reader = User.withUsername(required("PROTOCOLIA_READER_USERNAME"))
        .password("{bcrypt}" + encoder.encode(required("PROTOCOLIA_READER_PASSWORD")))
        .authorities(Manifest.READ_CAPABILITY).build();
    var manager = User.withUsername(required("PROTOCOLIA_MANAGER_USERNAME"))
        .password("{bcrypt}" + encoder.encode(required("PROTOCOLIA_MANAGER_PASSWORD")))
        .authorities(Manifest.READ_CAPABILITY, Manifest.WRITE_CAPABILITY).build();
    return new InMemoryUserDetailsManager(reader, manager);
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
