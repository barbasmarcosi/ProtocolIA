package dev.protocolia.modular;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.authentication.preauth.AbstractPreAuthenticatedProcessingFilter;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import org.springframework.scheduling.annotation.Scheduled;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

@RestController
@ConditionalOnProperty(name="PROTOCOLIA_BFF_ENABLED",havingValue="true")
public class BffSession {
  private final JdbcTemplate jdbc;
  private final JwtDecoder decoder;
  private final BffKeyring keyring;
  private final SecureRandom random=new SecureRandom();
  private final boolean testHttp;
  private final boolean secureBrowser;
  private final String origin;
  private final String sidCookie;
  record Session(String sid,String csrf,String access,Instant expires,Jwt jwt) {}

  public BffSession(JdbcTemplate jdbc,JwtDecoder decoder) {
    this.jdbc=jdbc;this.decoder=decoder;
    String cleanup=System.getenv().getOrDefault("PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS","300000");
    try{
      long millis=Long.parseLong(cleanup);
      if(millis<1000||millis>3600000)throw new NumberFormatException("out of range");
    }catch(NumberFormatException ex){
      throw new IllegalStateException("Invalid BFF cleanup interval (1000..3600000)",ex);
    }
    if(!"jwt".equals(System.getenv("PROTOCOLIA_AUTH_MODE"))||
       !"true".equals(System.getenv("PROTOCOLIA_OIDC_DISCOVERY_REQUIRED"))||
       !"true".equals(System.getenv("PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED"))||
       !"true".equals(System.getenv("PROTOCOLIA_BFF_ENABLED")))
      throw new IllegalStateException("BFF requires JWT and strict OIDC identity proof");
    this.keyring=new BffKeyring(
      System.getenv().getOrDefault("PROTOCOLIA_BFF_ENCRYPTION_KEY",""),
      System.getenv().getOrDefault("PROTOCOLIA_BFF_DECRYPTION_KEYS",""));
    testHttp="true".equals(System.getenv("PROTOCOLIA_JWT_ALLOW_TEST_HTTP"));
    String callback=System.getenv().getOrDefault("PROTOCOLIA_OIDC_BFF_REDIRECT_URI","");
    java.net.URI uri;
    try { uri=java.net.URI.create(callback); }
    catch(Exception ex){throw new IllegalStateException("Invalid BFF redirect",ex);}
    if(uri.getHost()==null||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||
        uri.getRawFragment()!=null||
        !"/api/_protocolia/bff/callback".equals(uri.getRawPath())||
        (!"https".equals(uri.getScheme())&&!(testHttp&&"http".equals(uri.getScheme()))))
      throw new IllegalStateException("Invalid registered BFF callback");
    this.origin=uri.getScheme()+"://"+uri.getAuthority();
    this.secureBrowser="https".equals(uri.getScheme());
    this.sidCookie=secureBrowser?"__Host-pia_bff":"pia_bff_dev";
    if(!Boolean.TRUE.equals(SecurityConfig.browserAuthConfig().get("requireIdToken")))
      throw new IllegalStateException("BFF requires verified OIDC identity");
    // Versioned Flyway V2 owns the schema; no runtime DDL from application code.
  }

  private String randomId(){
    byte[] b=new byte[32];random.nextBytes(b);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }
  private static String sha(String value){
    try{
      byte[] digest=MessageDigest.getInstance("SHA-256")
        .digest(value.getBytes(StandardCharsets.US_ASCII));
      return java.util.HexFormat.of().formatHex(digest);
    }catch(Exception e){throw new IllegalStateException(e);}
  }
  private String encrypt(String data){return keyring.encrypt(data);}
  private String decrypt(String data)throws Exception{return keyring.decrypt(data);}
  private String cookie(HttpServletRequest req,String name){
    if(req.getCookies()==null)return null;
    for(Cookie item:req.getCookies())if(name.equals(item.getName()))return item.getValue();
    return null;
  }
  private void setCookie(HttpServletResponse res,String name,String value,long seconds){
    res.addHeader("Set-Cookie",name+"="+value+"; Path=/; HttpOnly; SameSite=Lax; "+
      (secureBrowser?"Secure; ":"")+"Max-Age="+Math.max(0,seconds));
  }
  private void noStore(HttpServletResponse res){
    res.setHeader("Cache-Control","no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","no-referrer");
    // Global BFF response filter supplies a single CSP for HTML, assets and API.
  }
  // PostgreSQL SKIP LOCKED prevents concurrent replicas deleting the same row;
  // 200 rows per iteration bounds transaction duration and write amplification.
  @Scheduled(
    fixedDelayString="${PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS:300000}",
    initialDelayString="${PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS:300000}")
  public void cleanupExpiredSessions(){
    try{
      int count=jdbc.update("""
        WITH expired AS (
          SELECT sid_hash FROM protocolia_bff_sessions
          WHERE expires_at<now() ORDER BY expires_at
          LIMIT 200 FOR UPDATE SKIP LOCKED
        )
        DELETE FROM protocolia_bff_sessions AS s USING expired
        WHERE s.sid_hash=expired.sid_hash
        """);
      if(count>0)org.slf4j.LoggerFactory.getLogger(BffSession.class)
        .info("PROTOCOLIA_BFF_CLEANUP deleted={}",count);
    }catch(Exception ex){
      org.slf4j.LoggerFactory.getLogger(BffSession.class)
        .error("PROTOCOLIA_BFF_CLEANUP_FAILED",ex);
    }
  }
  private Session load(HttpServletRequest req){
    String sid=cookie(req,sidCookie);
    if(sid==null||!sid.matches("[A-Za-z0-9_-]{43}"))return null;
    try{
      List<Map<String,Object>> rows=jdbc.queryForList(
        "SELECT payload,expires_at FROM protocolia_bff_sessions WHERE sid_hash=? AND expires_at>now()",sha(sid));
      if(rows.size()!=1)return null;
      String decrypted=decrypt((String)rows.get(0).get("payload"));
      int split=decrypted.indexOf('\n');
      if(split!=43)return null;
      String csrf=decrypted.substring(0,split),access=decrypted.substring(split+1);
      if(!csrf.matches("[A-Za-z0-9_-]{43}")||access.length()>16384)return null;
      Jwt jwt=decoder.decode(access);
      Instant expires=jwt.getExpiresAt();
      if(expires==null||!expires.isAfter(Instant.now()))return null;
      return new Session(sid,csrf,access,expires,jwt);
    }catch(Exception ex){return null;}
  }
  private boolean checkCsrf(HttpServletRequest req,Session s){
    String token=req.getHeader("X-ProtocolIA-CSRF"),sentOrigin=req.getHeader("Origin");
    if(sentOrigin!=null&&!sentOrigin.equals(origin))return false;
    if("cross-site".equals(req.getHeader("Sec-Fetch-Site")))return false;
    if(token==null)return false;
    return MessageDigest.isEqual(token.getBytes(StandardCharsets.US_ASCII),
      s.csrf().getBytes(StandardCharsets.US_ASCII));
  }
  private List<String> capabilities(Jwt jwt){
    Object raw=jwt.getClaim("protocolia_capabilities");
    List<?> values=raw instanceof List<?> list?list:List.of();
    var declared=java.util.stream.Stream.of(Manifest.READ_CAPABILITIES,Manifest.WRITE_CAPABILITIES,
      Manifest.AUDIT_CAPABILITIES,Manifest.ASSIGN_CAPABILITIES,Manifest.FIELD_READ_CAPABILITIES)
      .flatMap(List::stream).collect(java.util.stream.Collectors.toSet());
    return values.stream().filter(v->v instanceof String s&&declared.contains(s))
      .map(v->(String)v).distinct().sorted().toList();
  }
  @GetMapping("/api/_protocolia/bff/login")
  public void login(HttpServletResponse response)throws IOException{
    noStore(response);
    // Servlet sendRedirect() can expand a relative URL using the internal
    // HTTP connection behind TLS termination. Use the operator-pinned
    // external OIDC callback origin, not arbitrary Forwarded headers.
    response.setStatus(HttpServletResponse.SC_FOUND);
    response.setHeader("Location",origin+"/oauth2/authorization/protocolia");
  }
  @GetMapping("/api/_protocolia/bff/session")
  public Map<String,Object> session(HttpServletRequest req,HttpServletResponse res){
    noStore(res);
    Session current=load(req);
    if(current==null)return Map.of("authenticated",false);
    return Map.of("authenticated",true,"username",current.jwt().getSubject(),
      "capabilities",capabilities(current.jwt()),"csrf",current.csrf());
  }
  @PostMapping("/api/_protocolia/bff/logout")
  public ResponseEntity<Void> logout(HttpServletRequest req,HttpServletResponse res){
    noStore(res);Session current=load(req);
    if(current==null)return ResponseEntity.status(401).build();
    if(!checkCsrf(req,current))return ResponseEntity.status(403).build();
    jdbc.update("DELETE FROM protocolia_bff_sessions WHERE sid_hash=?",sha(current.sid()));
    setCookie(res,sidCookie,"",0);
    return ResponseEntity.noContent().build();
  }

  public void authenticated(OAuth2AuthenticationToken authentication,
      HttpServletRequest request,HttpServletResponse response,
      OAuth2AuthorizedClientRepository authorizedClients)throws IOException{
    try{
      OAuth2AuthorizedClient client=authorizedClients.loadAuthorizedClient(
        authentication.getAuthorizedClientRegistrationId(),authentication,request);
      if(client==null||!(authentication.getPrincipal() instanceof OidcUser user))
        throw new IllegalArgumentException("Verified OIDC login missing");
      String access=client.getAccessToken().getTokenValue();
      Jwt jwt=decoder.decode(access);
      if(!user.getSubject().equals(jwt.getSubject()))
        throw new IllegalArgumentException("OIDC access identity mismatch");
      String atHash=user.getIdToken().getClaimAsString("at_hash");
      if(atHash!=null){
        byte[] hash=MessageDigest.getInstance("SHA-256")
          .digest(access.getBytes(StandardCharsets.US_ASCII));
        String expected=Base64.getUrlEncoder().withoutPadding().encodeToString(java.util.Arrays.copyOf(hash,16));
        if(!atHash.equals(expected))throw new IllegalArgumentException("Invalid OIDC at_hash");
      }
      Instant expires=client.getAccessToken().getExpiresAt();
      if(expires==null||user.getIdToken().getExpiresAt()==null)
        throw new IllegalArgumentException("Token expiration missing");
      if(expires.isAfter(user.getIdToken().getExpiresAt()))expires=user.getIdToken().getExpiresAt();
      Instant ceiling=Instant.now().plusSeconds(1200);
      if(expires.isAfter(ceiling))expires=ceiling;
      if(!expires.isAfter(Instant.now()))throw new IllegalArgumentException("Token expired");
      String sid=randomId(),csrf=randomId();
      jdbc.update("INSERT INTO protocolia_bff_sessions(sid_hash,payload,expires_at) VALUES(?,?,?)",
        sha(sid),encrypt(csrf+"\n"+access),java.sql.Timestamp.from(expires));
      authorizedClients.removeAuthorizedClient(authentication.getAuthorizedClientRegistrationId(),
        authentication,request,response);
      if(request.getSession(false)!=null)request.getSession(false).invalidate();
      setCookie(response,"JSESSIONID","",0);
      setCookie(response,"SESSION","",0);
      setCookie(response,sidCookie,sid,Math.max(1,expires.getEpochSecond()-Instant.now().getEpochSecond()));
      response.setStatus(303);
      response.setHeader("Location","/");
      noStore(response);
    }catch(Exception e){
      if(request.getSession(false)!=null)request.getSession(false).invalidate();
      setCookie(response,"JSESSIONID","",0);
      setCookie(response,"SESSION","",0);
      response.sendError(401,"OIDC login was not accepted");
    }
  }

  public Filter bffFilter(){
    return new OncePerRequestFilter(){
      @Override protected boolean shouldNotFilter(HttpServletRequest req){
        String path=req.getRequestURI();
        return !path.startsWith("/api/")||
          path.equals("/api/_protocolia/auth/config")||
          path.equals("/api/_protocolia/bff/session")||
          path.equals("/api/_protocolia/bff/logout")||
          path.equals("/api/_protocolia/bff/login");
      }
      @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,
          FilterChain chain)throws ServletException,IOException{
        noStore(response);
        if(request.getHeader("Authorization")!=null){response.sendError(401);return;}
        Session current=load(request);
        if(current==null){response.sendError(401);return;}
        if(!List.of("GET","HEAD","OPTIONS").contains(request.getMethod())&&!checkCsrf(request,current)){
          response.sendError(403);return;
        }
        HttpServletRequest wrapped=new HttpServletRequestWrapper(request){
          @Override public String getHeader(String name){
            return name.equalsIgnoreCase("Authorization")?"Bearer "+current.access():super.getHeader(name);
          }
          @Override public Enumeration<String> getHeaders(String name){
            return name.equalsIgnoreCase("Authorization")?
              Collections.enumeration(List.of("Bearer "+current.access())):super.getHeaders(name);
          }
          @Override public Enumeration<String> getHeaderNames(){
            List<String> all=new ArrayList<>(Collections.list(super.getHeaderNames()));
            if(all.stream().noneMatch(x->x.equalsIgnoreCase("Authorization")))all.add("Authorization");
            return Collections.enumeration(all);
          }
        };
        chain.doFilter(wrapped,response);
      }
    };
  }
}
