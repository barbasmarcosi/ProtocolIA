package dev.protocolia.security;

import jakarta.servlet.DispatcherType;
import java.util.ArrayList;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

/** Bounded local Basic demo policy; no claim of OAuth2/OIDC capabilities here.
 *  The application rejects unknown routes and requires explicit read or write
 *  authority at the HTTP boundary; it never trusts UI manifest metadata.
 */
@Configuration
public class DemoSecurity {
    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable()) // Stateless test/demo API only
            .authorizeHttpRequests(registry -> registry
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers(HttpMethod.GET, "/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/books", "/api/books/*").hasAuthority("catalog.read")
                .requestMatchers(HttpMethod.POST, "/api/books").hasAuthority("catalog.write")
                .requestMatchers(HttpMethod.PATCH, "/api/books/*/stock").hasAuthority("catalog.write")
                .anyRequest().denyAll())
            .httpBasic(Customizer.withDefaults());
        return http.build();
    }

    private static String require(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing " + name);
        return value;
    }

    @Bean
    UserDetailsService users() {
        String username = require("PROTOCOLIA_USER");
        String password = require("PROTOCOLIA_PASSWORD");
        if (password.length() < 16) throw new IllegalStateException("Password too short");
        String scopes = require("PROTOCOLIA_SCOPES");
        var authorities = new ArrayList<String>();
        for (String scope : scopes.split(",")) {
            String clean = scope.trim();
            if (!clean.equals("catalog.read") && !clean.equals("catalog.write"))
                throw new IllegalStateException("Unsupported demo authority");
            if (!authorities.contains(clean)) authorities.add(clean);
        }
        if (authorities.isEmpty()) throw new IllegalStateException("No demo authorities");
        var encoder = new BCryptPasswordEncoder(10);
        UserDetails owner = User.withUsername(username)
            .password("{bcrypt}" + encoder.encode(password))
            .authorities(authorities.toArray(String[]::new)).build();
        String viewerUser = System.getenv("PROTOCOLIA_VIEWER_USER");
        if (viewerUser == null || viewerUser.isBlank()) return new InMemoryUserDetailsManager(owner);
        String viewerPassword = require("PROTOCOLIA_VIEWER_PASSWORD");
        if (viewerPassword.length() < 16) throw new IllegalStateException("Viewer password too short");
        UserDetails viewer = User.withUsername(viewerUser)
            .password("{bcrypt}" + encoder.encode(viewerPassword))
            .authorities("catalog.read").build();
        return new InMemoryUserDetailsManager(owner, viewer);
    }
}
