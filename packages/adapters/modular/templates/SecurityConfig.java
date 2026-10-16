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
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
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
  private static volatile Map<String,Object> cachedBrowserAuth;
  private static boolean discoveryRequired(){
    String policy=System.getenv().getOrDefault("PROTOCOLIA_OIDC_DISCOVERY_REQUIRED","false");
    if(!policy.equals("true")&&!policy.equals("false"))
      throw new IllegalStateException("Invalid OIDC discovery policy");
    return policy.equals("true");
  }
  private static String required(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) throw new IllegalStateException("Missing test-only environment: " + key);
    return value;
  }
  static synchronized Map<String,Object> browserAuthConfig(){
    if(cachedBrowserAuth!=null)return cachedBrowserAuth;
    boolean discovery=discoveryRequired();
    if(!mode().equals("jwt")){
      if(discovery)throw new IllegalStateException("OIDC discovery requires JWT browser PKCE");
      return Map.of("mode","demo","enabled",false);
    }
    var names=List.of("PROTOCOLIA_OIDC_AUTHORIZATION_ENDPOINT","PROTOCOLIA_OIDC_TOKEN_ENDPOINT",
        "PROTOCOLIA_OIDC_CLIENT_ID","PROTOCOLIA_OIDC_REDIRECT_URI");
    var vals=names.stream().map(name->System.getenv().getOrDefault(name,"").trim()).toList();
    if(vals.stream().allMatch(String::isBlank)){
      if(discovery)throw new IllegalStateException("OIDC discovery requires configured browser PKCE");
      return Map.of("mode","jwt","enabled",false);
    }
    if(vals.stream().anyMatch(String::isBlank))throw new IllegalStateException("Incomplete OAuth2 PKCE browser configuration");
    var authorization=url(vals.get(0),"authorization").toString();
    var token=url(vals.get(1),"token").toString();
    var redirect=url(vals.get(3),"redirect");
    if(!redirect.getPath().equals("/")||redirect.getQuery()!=null)
      throw new IllegalStateException("Unsafe PKCE callback URI");
    var client=vals.get(2);
    var scope=System.getenv().getOrDefault("PROTOCOLIA_OIDC_SCOPE","openid profile").trim();
    if(!client.matches("[A-Za-z0-9_.:-]{3,128}")||
      !scope.matches("[A-Za-z0-9_.:-]+( [A-Za-z0-9_.:-]+){0,12}"))
      throw new IllegalStateException("Invalid PKCE client or scope");
    var issuer=required("PROTOCOLIA_JWT_ISSUER");
    if(discovery)verifyOidcMetadata(issuer,authorization,token,required("PROTOCOLIA_JWT_JWKS_URI"));
    cachedBrowserAuth=Map.of("mode","jwt","enabled",true,"issuer",issuer,
      "authorizationEndpoint",authorization,"tokenEndpoint",token,
      "clientId",client,"redirectUri",redirect.toString(),"scope",scope,
      "requireIssuerResponse",discovery);
    return cachedBrowserAuth;
  }
  private static void verifyOidcMetadata(String issuer,String authorization,String token,String jwks){
    URI trustedIssuer=url(issuer,"OIDC issuer");
    if(trustedIssuer.getRawQuery()!=null||trustedIssuer.getRawFragment()!=null)
      throw new IllegalStateException("Unsafe OIDC issuer");
    // No user input or provider-controlled location is permitted in discovery URL.
    String discovery=issuer.replaceFirst("/$","")+"/.well-known/openid-configuration";
    JsonNode document;
    try{
      var client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
        .followRedirects(HttpClient.Redirect.NEVER).build();
      var request=HttpRequest.newBuilder(URI.create(discovery))
        .timeout(Duration.ofSeconds(4)).header("Accept","application/json").GET().build();
      var response=client.send(request,HttpResponse.BodyHandlers.ofInputStream());
      try(var body=response.body()){
        if(response.statusCode()!=200||
            !response.headers().firstValue("content-type").orElse("").toLowerCase(Locale.ROOT).contains("application/json"))
          throw new IllegalStateException("Invalid OIDC discovery response");
        byte[] bytes=body.readNBytes(32769);
        if(bytes.length>32768)throw new IllegalStateException("Oversized OIDC metadata");
        document=new ObjectMapper().readTree(bytes);
      }
    }catch(InterruptedException ex){
      Thread.currentThread().interrupt();
      throw new IllegalStateException("OIDC discovery interrupted; refusing startup",ex);
    }catch(Exception ex){
      throw new IllegalStateException("OIDC discovery unavailable or invalid; refusing startup",ex);
    }
    if(document==null||!document.isObject())
      throw new IllegalStateException("Invalid OIDC discovery document");
    var expected=Map.of("issuer",issuer,"authorization_endpoint",authorization,
      "token_endpoint",token,"jwks_uri",jwks);
    for(var entry:expected.entrySet()){
      var value=document.get(entry.getKey());
      if(value==null||!value.isTextual()||!value.textValue().equals(entry.getValue()))
        throw new IllegalStateException("OIDC discovery metadata mismatch: "+entry.getKey());
    }
    var responseTypes=document.path("response_types_supported");
    var challenges=document.path("code_challenge_methods_supported");
    if(!responseTypes.isArray()||!challenges.isArray()||
       !java.util.stream.StreamSupport.stream(responseTypes.spliterator(),false).anyMatch(n->n.isTextual()&&n.textValue().equals("code"))||
       !java.util.stream.StreamSupport.stream(challenges.spliterator(),false).anyMatch(n->n.isTextual()&&n.textValue().equals("S256"))||
       !document.path("authorization_response_iss_parameter_supported").isBoolean()||
       !document.path("authorization_response_iss_parameter_supported").booleanValue())
      throw new IllegalStateException("OIDC provider does not advertise required PKCE/issuer response support");
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
    if(selected.equals("jwt"))browserAuthConfig();
    if(selected.equals("jwt")&&"true".equals(System.getenv("PROTOCOLIA_ALLOW_DEMO_AUTH")))
      throw new IllegalStateException("Demo credentials forbidden in JWT mode");
    http.csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(a -> a.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            .requestMatchers("/health", "/", "/index.html", "/protocolia-ui.json", "/assets/**",
                "/api/_protocolia/auth/config").permitAll()
            .requestMatchers("/api/**").authenticated()
            .anyRequest().denyAll())
        ;
    if(selected.equals("jwt")){
      JwtAuthenticationConverter converter=new JwtAuthenticationConverter();
      converter.setJwtGrantedAuthoritiesConverter(jwt->{
        List<?> declared=jwt.getClaim("protocolia_capabilities");
        return declared.stream().map(value->(org.springframework.security.core.GrantedAuthority)new SimpleGrantedAuthority((String)value)).toList();
      });
      http.oauth2ResourceServer(o->o.jwt(jwt->jwt.jwtAuthenticationConverter(converter)));
    }else http.httpBasic(Customizer.withDefaults());
    return http.build();
  }
}
