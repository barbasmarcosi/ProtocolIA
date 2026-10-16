package dev.protocolia.modular;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.session.jdbc.config.annotation.web.http.EnableJdbcHttpSession;

/**
 * Persist only the short-lived Spring Security OAuth2 authorization transaction.
 * The post-login ProtocolIA BFF session is independently stored as an encrypted
 * record in protocolia_bff_sessions, never in HttpSession.
 *
 * Explicit conditional configuration keeps demo/ordinary JWT deployments
 * stateless. The Boot JDBC session auto-configuration is intentionally excluded
 * in application.properties to avoid enabling the session store outside BFF.
 */
@Configuration(proxyBeanMethods=false)
@ConditionalOnProperty(name="PROTOCOLIA_BFF_ENABLED",havingValue="true")
@EnableJdbcHttpSession(maxInactiveIntervalInSeconds=300)
@EnableScheduling
public class BffHttpSessionConfig {
  private static final String CSP=String.join("; ",
    "default-src 'self'","script-src 'self'","script-src-attr 'none'",
    "style-src 'self'","style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'","img-src 'self' data:",
    "font-src 'self' data:","connect-src 'self'","manifest-src 'self'",
    "form-action 'self'","base-uri 'none'","object-src 'none'",
    "frame-ancestors 'none'");

  @Bean
  jakarta.servlet.Filter bffResponseHeaders(){
    return new OncePerRequestFilter(){
      @Override protected void doFilterInternal(HttpServletRequest request,
          HttpServletResponse response,FilterChain chain)
          throws ServletException,IOException {
        boolean production=!"true".equals(System.getenv("PROTOCOLIA_JWT_ALLOW_TEST_HTTP"));
        response.setHeader("Content-Security-Policy",CSP+
          (production?"; upgrade-insecure-requests":""));
        response.setHeader("X-Content-Type-Options","nosniff");
        response.setHeader("Referrer-Policy","no-referrer");
        response.setHeader("X-Frame-Options","DENY");
        if(production)response.setHeader("Strict-Transport-Security","max-age=31536000");
        chain.doFilter(request,response);
      }
    };
  }
  // TLS may terminate at an ingress. Do not infer Secure from the internal
  // HTTP hop or from untrusted X-Forwarded-Proto headers.
  @Bean
  CookieSerializer bffCookieSerializer(){
    DefaultCookieSerializer cookie=new DefaultCookieSerializer();
    cookie.setCookieName("SESSION");
    cookie.setCookiePath("/");
    cookie.setSameSite("Lax");
    cookie.setUseHttpOnlyCookie(true);
    cookie.setUseSecureCookie(!"true".equals(
      System.getenv("PROTOCOLIA_JWT_ALLOW_TEST_HTTP")));
    return cookie;
  }
}
