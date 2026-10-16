package dev.protocolia.modular;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
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
public class BffHttpSessionConfig {}
