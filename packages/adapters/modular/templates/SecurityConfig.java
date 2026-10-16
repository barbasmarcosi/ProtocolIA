package dev.protocolia.modular;

import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import java.net.URI;
import java.util.*;
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
  private static String mode(){
    String value=System.getenv().getOrDefault("PROTOCOLIA_AUTH_MODE","demo");
    if(!value.equals("demo")&&!value.equals("jwt"))
      throw new IllegalStateException("Unsupported ProtocolIA authentication mode");
    return value;
  }
  private static Set<String> grants(){
    var all=new HashSet<String>();
    java.util.stream.Stream.of(Manifest.READ_CAPABILITIES,Manifest.WRITE_CAPABILITIES,
        Manifest.AUDIT_CAPABILITIES,Manifest.ASSIGN_CAPABILITIES,Manifest.FIELD_READ_CAPABILITIES)
      .flatMap(List::stream).forEach(all::add);
    return all;
  }
  private static URI url(String raw,String name){
    try{
      URI url=URI.create(raw);
      boolean unsafeTest="true".equals(System.getenv("PROTOCOLIA_JWT_ALLOW_TEST_HTTP"));
      if(!"https".equals(url.getScheme())&&!(unsafeTest&&"http".equals(url.getScheme())))
        throw new IllegalArgumentException("HTTPS required");
      if(url.getHost()==null||url.getRawUserInfo()!=null||url.getRawFragment()!=null||raw.length()>500)
        throw new IllegalArgumentException("Invalid URI");
      return url;
    }catch(Exception ex){throw new IllegalStateException("Invalid JWT "+name+" URI");}
  }
  @Bean
  @ConditionalOnProperty(name="PROTOCOLIA_AUTH_MODE",havingValue="jwt")
  JwtDecoder jwtDecoder(){
    if("true".equals(System.getenv("PROTOCOLIA_ALLOW_DEMO_AUTH")))
      throw new IllegalStateException("JWT mode cannot enable demo credentials");
    String issuer=required("PROTOCOLIA_JWT_ISSUER");
    String audience=required("PROTOCOLIA_JWT_AUDIENCE");
    if(!audience.matches("[A-Za-z0-9][A-Za-z0-9_.:/-]{2,190}"))
      throw new IllegalStateException("Invalid JWT audience");
    url(issuer,"issuer");
    String jwks=url(required("PROTOCOLIA_JWT_JWKS_URI"),"JWKS").toString();
    NimbusJwtDecoder decoder=NimbusJwtDecoder.withJwkSetUri(jwks)
      .jwsAlgorithm(SignatureAlgorithm.RS256).build();
    var defaults=JwtValidators.createDefaultWithIssuer(issuer);
    OAuth2TokenValidator<Jwt> policy=jwt->{
      Object raw=jwt.getClaim("protocolia_capabilities");
      if(jwt.getExpiresAt()==null||jwt.getIssuedAt()==null||jwt.getSubject()==null||
        jwt.getSubject().isBlank()||jwt.getSubject().length()>128||
        !jwt.getAudience().contains(audience)||!(raw instanceof List<?> caps)||caps.size()>16||
        new HashSet<>(caps).size()!=caps.size()||
        caps.stream().anyMatch(c->!(c instanceof String s)||s.equals("public")||!grants().contains(s)))
        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token",
          "Invalid ProtocolIA JWT claims",null));
      return OAuth2TokenValidatorResult.success();
    };
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(defaults,policy));
    return decoder;
  }
  @Bean
  UserDetailsService users() {
    if(mode().equals("jwt"))return new InMemoryUserDetailsManager();
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
    String selected=mode();
    if(selected.equals("jwt")&&"true".equals(System.getenv("PROTOCOLIA_ALLOW_DEMO_AUTH")))
      throw new IllegalStateException("Demo credentials forbidden in JWT mode");
    http.csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(a -> a.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            .requestMatchers("/health", "/", "/index.html", "/protocolia-ui.json", "/assets/**").permitAll()
            .requestMatchers("/api/**").authenticated()
            .anyRequest().denyAll())
        ;
    if(selected.equals("jwt")){
      JwtAuthenticationConverter converter=new JwtAuthenticationConverter();
      converter.setJwtGrantedAuthoritiesConverter(jwt->{
        List<?> declared=jwt.getClaim("protocolia_capabilities");
        return declared.stream().map(value->new SimpleGrantedAuthority((String)value)).toList();
      });
      http.oauth2ResourceServer(o->o.jwt(jwt->jwt.jwtAuthenticationConverter(converter)));
    }else http.httpBasic(Customizer.withDefaults());
    return http.build();
  }
}
