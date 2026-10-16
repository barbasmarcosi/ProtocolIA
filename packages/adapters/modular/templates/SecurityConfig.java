package dev.protocolia.modular;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
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
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.oauth2.client.web.OAuth2LoginAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.FilterChain;
import java.io.IOException;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
  private static volatile Map<String,Object> cachedBrowserAuth;
  static boolean bffEnabled(){
    String flag=System.getenv().getOrDefault("PROTOCOLIA_BFF_ENABLED","false");
    if(!flag.equals("true")&&!flag.equals("false"))
      throw new IllegalStateException("Invalid BFF policy");
    return flag.equals("true");
  }
  private static volatile JwtDecoder identityDecoder;
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
    String proof=System.getenv().getOrDefault("PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED","false");
    if(!proof.equals("true")&&!proof.equals("false"))
      throw new IllegalStateException("Invalid OIDC ID token policy");
    if(proof.equals("true")&&!discovery)
      throw new IllegalStateException("OIDC ID token proof requires strict issuer discovery");
    var scope=System.getenv().getOrDefault("PROTOCOLIA_OIDC_SCOPE","openid profile").trim();
    if(!client.matches("[A-Za-z0-9_.:-]{3,128}")||
      !scope.matches("[A-Za-z0-9_.:-]+( [A-Za-z0-9_.:-]+){0,12}"))
      throw new IllegalStateException("Invalid PKCE client or scope");
    if(proof.equals("true")&&!Arrays.asList(scope.split(" ")).contains("openid"))
      throw new IllegalStateException("OIDC ID token proof requires openid scope");
    var issuer=required("PROTOCOLIA_JWT_ISSUER");
    if(discovery)verifyOidcMetadata(issuer,authorization,token,required("PROTOCOLIA_JWT_JWKS_URI"));
    if(proof.equals("true")){
      var decoder=NimbusJwtDecoder.withJwkSetUri(url(required("PROTOCOLIA_JWT_JWKS_URI"),"JWKS").toString())
        .jwsAlgorithm(SignatureAlgorithm.RS256).build();
      decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(issuer));
      identityDecoder=decoder;
    }
    cachedBrowserAuth=Map.of("mode","jwt","enabled",true,"issuer",issuer,
      "authorizationEndpoint",authorization,"tokenEndpoint",token,
      "clientId",client,"redirectUri",redirect.toString(),"scope",scope,
      "requireIssuerResponse",discovery,"requireIdToken",proof.equals("true"));
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
  static void verifyOidcIdentity(HttpServletRequest request,Authentication user){
    if(bffEnabled()||!Boolean.TRUE.equals(browserAuthConfig().get("requireIdToken")))return;
    String idToken=request.getHeader("X-ProtocolIA-ID-Token");
    String nonce=request.getHeader("X-ProtocolIA-OIDC-Nonce");
    if(idToken==null||idToken.length()>16384||nonce==null||
       !nonce.matches("[A-Za-z0-9_-]{43,}"))
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"OIDC identity proof required");
    try{
      Jwt jwt=identityDecoder.decode(idToken);
      String client=(String)browserAuthConfig().get("clientId");
      List<String> audience=jwt.getAudience();
      if(!"RS256".equals(jwt.getHeaders().get("alg"))||
         audience.size()!=1||!client.equals(audience.get(0))||
         (jwt.hasClaim("azp")&&!client.equals(jwt.getClaimAsString("azp")))||
         !nonce.equals(jwt.getClaimAsString("nonce"))||
         !user.getName().equals(jwt.getSubject())||
         jwt.getIssuedAt()==null||
         jwt.getIssuedAt().isBefore(java.time.Instant.now().minusSeconds(600))||
         jwt.getIssuedAt().isAfter(java.time.Instant.now().plusSeconds(60)))
        throw new IllegalArgumentException("OIDC claim mismatch");
      if(jwt.hasClaim("at_hash")){
        String bearer=request.getHeader("Authorization");
        if(bearer==null||!bearer.startsWith("Bearer "))
          throw new IllegalArgumentException("Missing access token");
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(
          bearer.substring(7).getBytes(StandardCharsets.US_ASCII));
        String actual=Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOf(digest,16));
        if(!actual.equals(jwt.getClaimAsString("at_hash")))
          throw new IllegalArgumentException("Invalid at_hash");
      }
    }catch(Exception ex){
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid OIDC identity proof");
    }
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
  @ConditionalOnProperty(name="PROTOCOLIA_BFF_ENABLED",havingValue="true")
  ClientRegistrationRepository bffClientRegistration(){
    Map<String,Object> config=browserAuthConfig();
    if(!mode().equals("jwt")||
       !"true".equals(System.getenv("PROTOCOLIA_OIDC_DISCOVERY_REQUIRED"))||
       !"true".equals(System.getenv("PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED"))||
       !Boolean.TRUE.equals(config.get("requireIssuerResponse"))||
       !Boolean.TRUE.equals(config.get("requireIdToken")))
      throw new IllegalStateException("BFF requires strict OIDC and signed ID Token policy");
    String redirect=required("PROTOCOLIA_OIDC_BFF_REDIRECT_URI");
    URI location=url(redirect,"BFF callback");
    if(!"/api/_protocolia/bff/callback".equals(location.getRawPath())||
       location.getRawQuery()!=null||location.getRawFragment()!=null)
      throw new IllegalStateException("Unsafe Spring BFF callback");
    ClientRegistration client=ClientRegistration.withRegistrationId("protocolia")
      .clientId((String)config.get("clientId"))
      .clientAuthenticationMethod(ClientAuthenticationMethod.NONE)
      .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
      .redirectUri(redirect)
      .scope(((String)config.get("scope")).split(" "))
      .authorizationUri((String)config.get("authorizationEndpoint"))
      .tokenUri((String)config.get("tokenEndpoint"))
      .jwkSetUri(required("PROTOCOLIA_JWT_JWKS_URI"))
      .issuerUri((String)config.get("issuer"))
      .userNameAttributeName("sub")
      .clientName("ProtocolIA")
      .build();
    return new InMemoryClientRegistrationRepository(client);
  }

  @Bean
  SecurityFilterChain security(HttpSecurity http,
      ObjectProvider<BffSession> sessions,
      ObjectProvider<ClientRegistrationRepository> registrations,
      ObjectProvider<OAuth2AuthorizedClientRepository> clients) throws Exception {
    String selected=mode();
    if(selected.equals("jwt"))browserAuthConfig();
    if(selected.equals("jwt")&&"true".equals(System.getenv("PROTOCOLIA_ALLOW_DEMO_AUTH")))
      throw new IllegalStateException("Demo credentials forbidden in JWT mode");
    boolean bff=bffEnabled();
    if(bff&&!selected.equals("jwt"))
      throw new IllegalStateException("BFF requires JWT mode");
    http.csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(s -> s.sessionCreationPolicy(bff?
            SessionCreationPolicy.IF_REQUIRED:SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(a -> a.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
            .requestMatchers("/health", "/", "/index.html", "/protocolia-ui.json", "/assets/**",
                "/api/_protocolia/auth/config",
                "/api/_protocolia/bff/login","/api/_protocolia/bff/session",
                "/api/_protocolia/bff/logout","/api/_protocolia/bff/callback",
                "/oauth2/authorization/**").permitAll()
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
    if(bff){
      BffSession store=sessions.getObject();
      var resolver=new DefaultOAuth2AuthorizationRequestResolver(
        registrations.getObject(),"/oauth2/authorization");
      resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
      http.oauth2Login(o->o.authorizationEndpoint(end->end.authorizationRequestResolver(resolver))
        .redirectionEndpoint(end->end.baseUri("/api/_protocolia/bff/callback"))
        .successHandler((req,res,auth)->store.authenticated(
          (OAuth2AuthenticationToken)auth,req,res,clients.getObject()))
        .failureHandler((req,res,error)->res.sendError(401,"OIDC authentication failed")));
      http.addFilterBefore(new OncePerRequestFilter(){
        @Override protected boolean shouldNotFilter(jakarta.servlet.http.HttpServletRequest request){
          return !request.getRequestURI().equals("/api/_protocolia/bff/callback");
        }
        @Override protected void doFilterInternal(jakarta.servlet.http.HttpServletRequest request,
            HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
          String[] issuers=request.getParameterValues("iss");
          if(issuers==null||issuers.length!=1||
             !issuers[0].equals(System.getenv("PROTOCOLIA_JWT_ISSUER"))){
            response.sendError(400,"OIDC issuer response rejected");return;
          }
          chain.doFilter(request,response);
        }
      },OAuth2LoginAuthenticationFilter.class);
      http.addFilterBefore(store.bffFilter(),BearerTokenAuthenticationFilter.class);
      http.exceptionHandling(e->e.authenticationEntryPoint((req,res,error)->res.sendError(401)));
    }
    return http.build();
  }
}
