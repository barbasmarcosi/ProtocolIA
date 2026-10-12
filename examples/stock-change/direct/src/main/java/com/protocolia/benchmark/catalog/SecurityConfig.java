package com.protocolia.benchmark.catalog;

import java.util.Arrays;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        http.csrf(c -> c.disable());
        http.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        http.authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.GET, "/actuator/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/books/*").hasAuthority("catalog.read")
                .requestMatchers(HttpMethod.POST, "/api/books").hasAuthority("catalog.write")
                .requestMatchers(HttpMethod.PATCH, "/api/books/*/stock").hasAuthority("catalog.write")
                .anyRequest().denyAll());
        http.httpBasic(Customizer.withDefaults());
        return http.build();
    }

    @Bean
    UserDetailsService users() {
        String user = System.getenv("PROTOCOLIA_USER");
        String password = System.getenv("PROTOCOLIA_PASSWORD");
        String scopes = System.getenv("PROTOCOLIA_SCOPES");
        if (user == null || user.isBlank() || password == null || password.length() < 16
                || scopes == null || scopes.isBlank()) {
            throw new IllegalStateException("Demo credentials and scopes are required");
        }
        var encoder = new BCryptPasswordEncoder();
        var primary = User.withUsername(user).password("{bcrypt}" + encoder.encode(password))
                .authorities(Arrays.stream(scopes.split(",")).map(String::trim)
                        .filter(s -> !s.isEmpty()).toArray(String[]::new))
                .build();
        String viewer = System.getenv("PROTOCOLIA_VIEWER_USER");
        String viewerPassword = System.getenv("PROTOCOLIA_VIEWER_PASSWORD");
        if ((viewer == null) != (viewerPassword == null)) {
            throw new IllegalStateException("Viewer username/password must be set together");
        }
        if (viewer == null) {
            return new InMemoryUserDetailsManager(primary);
        }
        if (viewer.isBlank() || viewer.equals(user) || viewerPassword.length() < 16) {
            throw new IllegalStateException("Invalid viewer credentials");
        }
        var readOnly = User.withUsername(viewer)
                .password("{bcrypt}" + encoder.encode(viewerPassword))
                .authorities("catalog.read").build();
        return new InMemoryUserDetailsManager(primary, readOnly);
    }
}
