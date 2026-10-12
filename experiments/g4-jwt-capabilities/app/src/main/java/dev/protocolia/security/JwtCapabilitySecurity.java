package dev.protocolia.security;

import jakarta.servlet.DispatcherType;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

/** G4 JWT pilot only. A real IdP supplies a trusted HTTPS JWKS.
 * OAuth scopes are NOT ProtocolIA capabilities; mapping is trusted server code.
 * No Basic fallback, no test private key, no minted token endpoint.
 */
@Configuration
@EnableMethodSecurity
public class JwtCapabilitySecurity {
    private final String issuer;
    private final String audience;
    private final String jwks;
    private final String readScope;
    private final String writeScope;
    private final boolean allowInsecureTestJwks;

    public JwtCapabilitySecurity(
        @Value("${protocolia.jwt.issuer}") String issuer,
        @Value("${protocolia.jwt.audience}") String audience,
        @Value("${protocolia.jwt.jwk-set-uri}") String jwks,
        @Value("${protocolia.jwt.read-scope}") String readScope,
        @Value("${protocolia.jwt.write-scope}") String writeScope,
        @Value("${protocolia.jwt.test-only-allow-loopback-http:false}") boolean allowInsecureTestJwks
    ) {
        this.issuer = required(issuer, "issuer");
        this.audience = required(audience, "audience");
        this.jwks = required(jwks, "jwks");
        this.readScope = validScope(readScope);
        this.writeScope = validScope(writeScope);
        this.allowInsecureTestJwks = allowInsecureTestJwks;
        if (this.readScope.equals(this.writeScope)) throw new IllegalArgumentException("JWT scopes must differ");
        if (this.readScope.startsWith("catalog.") || this.writeScope.startsWith("catalog."))
            throw new IllegalArgumentException("JWT OAuth scopes must not equal ProtocolIA capabilities");
        URI issuerUri = URI.create(this.issuer);
        URI jwksUri = URI.create(this.jwks);
        if (!"https".equalsIgnoreCase(issuerUri.getScheme()) || issuerUri.getHost() == null)
            throw new IllegalArgumentException("JWT issuer must have an HTTPS hostname");
        boolean testLoopback = allowInsecureTestJwks &&
            "http".equalsIgnoreCase(jwksUri.getScheme()) &&
            "127.0.0.1".equals(jwksUri.getHost()) && jwksUri.getPort() > 0;
        if ((!testLoopback && !"https".equalsIgnoreCase(jwksUri.getScheme())) ||
                jwksUri.getHost() == null || jwksUri.getUserInfo() != null)
            throw new IllegalArgumentException("JWKS must be HTTPS; only isolated loopback tests permit HTTP");
    }

    private static String required(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Missing trusted JWT " + field);
        return value;
    }
    private static String validScope(String raw) {
        String scope = required(raw, "scope");
        if (!scope.matches("[a-z][a-zA-Z0-9:_./-]{0,79}"))
            throw new IllegalArgumentException("Unsupported OAuth scope syntax");
        return scope;
    }

    @Bean
    JwtDecoder jwtDecoder() {
        // Never trust token-supplied keys, 'none' algorithm or dynamically
        // supplied issuer; JWKS endpoint and validation targets are trusted configuration.
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(jwks)
            .jwsAlgorithm(SignatureAlgorithm.RS256).build();
        OAuth2TokenValidator<Jwt> audValidator = token ->
            token.getAudience().contains(audience) ? OAuth2TokenValidatorResult.success() :
            OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "Wrong audience", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            JwtValidators.createDefaultWithIssuer(issuer), audValidator));
        return decoder;
    }

    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter scopes = new JwtGrantedAuthoritiesConverter();
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Collection<GrantedAuthority> raw = scopes.convert(jwt);
            List<GrantedAuthority> capabilities = new ArrayList<>();
            if (raw != null) {
                for (GrantedAuthority auth : raw) {
                    if (("SCOPE_" + readScope).equals(auth.getAuthority()))
                        capabilities.add(new SimpleGrantedAuthority("catalog.read"));
                    if (("SCOPE_" + writeScope).equals(auth.getAuthority()))
                        capabilities.add(new SimpleGrantedAuthority("catalog.write"));
                }
            }
            return capabilities;
        });
        converter.setPrincipalClaimName("sub");
        return converter;
    }

    @Bean
    SecurityFilterChain resourceSecurity(HttpSecurity http,
                                         JwtAuthenticationConverter converter) throws Exception {
        http.csrf(csrf -> csrf.disable()) // Stateless bearer-only API
            .authorizeHttpRequests(registry -> registry
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                .requestMatchers(HttpMethod.GET, "/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/books", "/api/books/*").hasAuthority("catalog.read")
                .requestMatchers(HttpMethod.POST, "/api/books").hasAuthority("catalog.write")
                .requestMatchers(HttpMethod.PATCH, "/api/books/*/stock").hasAuthority("catalog.write")
                .anyRequest().denyAll())
            .httpBasic(basic -> basic.disable())
            .formLogin(login -> login.disable())
            .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(converter)));
        return http.build();
    }
}
