package dev.protocolia.generated;
@org.springframework.context.annotation.Configuration
@org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
public class SecurityConfig {
    @org.springframework.context.annotation.Bean
    org.springframework.security.web.SecurityFilterChain chain(org.springframework.security.config.annotation.web.builders.HttpSecurity http) throws Exception {
        http.csrf(org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer::disable);
        http.sessionManagement(s -> s.sessionCreationPolicy(org.springframework.security.config.http.SessionCreationPolicy.STATELESS));
        http.authorizeHttpRequests(a -> {
            a.requestMatchers(org.springframework.http.HttpMethod.GET, "/health").permitAll();
            a.anyRequest().authenticated();
        });
        http.httpBasic(org.springframework.security.config.Customizer.withDefaults());
        return http.build();
    }
    @org.springframework.context.annotation.Bean
    org.springframework.security.core.userdetails.UserDetailsService accounts() {
        String user=System.getenv("PROTOCOLIA_USER");
        String password=System.getenv("PROTOCOLIA_PASSWORD");
        String scopes=System.getenv("PROTOCOLIA_SCOPES");
        if (user==null || user.isBlank() || password==null || password.length()<16 || scopes==null || scopes.isBlank())
            throw new IllegalStateException("Require PROTOCOLIA_USER, PROTOCOLIA_PASSWORD >=16 chars and PROTOCOLIA_SCOPES");
        var authorities=java.util.Arrays.stream(scopes.split(",")).map(String::trim)
            .filter(s->!s.isEmpty()).toArray(String[]::new);
        var encoder=new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder();
        var details=org.springframework.security.core.userdetails.User.withUsername(user)
            .password("{bcrypt}"+encoder.encode(password)).authorities(authorities).build();
        String reader=System.getenv("PROTOCOLIA_VIEWER_USER");
        String readerPassword=System.getenv("PROTOCOLIA_VIEWER_PASSWORD");
        if ((reader==null)!=(readerPassword==null))
            throw new IllegalStateException("Both PROTOCOLIA_VIEWER_USER and PROTOCOLIA_VIEWER_PASSWORD required");
        if (reader!=null) {
            if (reader.isBlank() || readerPassword.length()<16 || reader.equals(user))
                throw new IllegalStateException("Invalid isolated read-only test identity");
            var viewer=org.springframework.security.core.userdetails.User.withUsername(reader)
                .password("{bcrypt}"+encoder.encode(readerPassword)).authorities("products.read").build();
            return new org.springframework.security.provisioning.InMemoryUserDetailsManager(details,viewer);
        }
        return new org.springframework.security.provisioning.InMemoryUserDetailsManager(details);
    }
}
