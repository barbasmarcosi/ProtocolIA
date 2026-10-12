package dev.protocolia.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import dev.protocolia.domain.BooksDelegate;
import dev.protocolia.upstream.api.BooksApiDelegate;
import dev.protocolia.upstream.model.BookRequest;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.api.AfterAll;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.test.context.support.WithMockUser;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.junit.jupiter.api.Assertions.*;

/** Real RSA signatures, local JWKS HTTP, issuer/audience/expiry validators and
 * live random-port Spring MVC. No fake JwtDecoder and no external IdP.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class JwtAuthorizationHttpTest {
    static final String ISSUER = "https://issuer.g4.protocolia.invalid";
    static final String AUDIENCE = "protocolia-books";
    static final String READ = "books:read";
    static final String WRITE = "books:write";
    static final String KEY_ID = "g4-ephemeral-key";
    static final KeyPair keypair = makeKey();
    static final HttpServer jwks = createJwks();

    @DynamicPropertySource
    static void authProperties(DynamicPropertyRegistry registry) {
        registry.add("protocolia.jwt.issuer", () -> ISSUER);
        registry.add("protocolia.jwt.audience", () -> AUDIENCE);
        registry.add("protocolia.jwt.jwk-set-uri",
            () -> "http://127.0.0.1:" + jwks.getAddress().getPort() + "/jwks");
        registry.add("protocolia.jwt.read-scope", () -> READ);
        registry.add("protocolia.jwt.write-scope", () -> WRITE);
        registry.add("protocolia.jwt.test-only-allow-loopback-http", () -> "true");
    }

    private static KeyPair makeKey() {
        try {
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            return gen.generateKeyPair();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static HttpServer createJwks() {
        try {
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            RSAKey publicKey = new RSAKey.Builder(
                (java.security.interfaces.RSAPublicKey) keypair.getPublic())
                .keyID(KEY_ID).algorithm(JWSAlgorithm.RS256).build();
            byte[] contents = ("{\"keys\":[" + publicKey.toJSONString() + "]}")
                .getBytes(StandardCharsets.UTF_8);
            server.createContext("/jwks", exchange -> {
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, contents.length);
                try (var stream = exchange.getResponseBody()) { stream.write(contents); }
            });
            server.start();
            return server;
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    @AfterAll
    static void stopJwks() { jwks.stop(0); }

    @LocalServerPort int port;
    @Autowired BooksApiDelegate securedDomainPort;

    private String jwt(String scope, String issuer, String aud,
                       Instant from, Instant expires, Instant nbf,
                       boolean forged, boolean capabilitiesClaim) throws Exception {
        var b = new JWTClaimsSet.Builder()
            .issuer(issuer).audience(aud).subject("g4-integration-subject")
            .issueTime(Date.from(from)).expirationTime(Date.from(expires))
            .notBeforeTime(Date.from(nbf));
        if (scope != null) b.claim("scope", scope);
        if (capabilitiesClaim) b.claim("capabilities", List.of("catalog.read", "catalog.write"));
        SignedJWT token = new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY_ID).build(), b.build());
        java.security.PrivateKey privateKey = keypair.getPrivate();
        if (forged) privateKey = makeKey().getPrivate();
        token.sign(new RSASSASigner((java.security.interfaces.RSAPrivateKey) privateKey));
        return token.serialize();
    }
    private String valid(String scope) throws Exception {
        Instant now = Instant.now();
        return jwt(scope, ISSUER, AUDIENCE, now.minusSeconds(5),
            now.plusSeconds(300), now.minusSeconds(5), false, false);
    }
    private HttpResponse<String> http(String method, String path,
                                      String json, String bearer) throws Exception {
        var request = HttpRequest.newBuilder(
            URI.create("http://127.0.0.1:" + port + path))
            .timeout(Duration.ofSeconds(15));
        if (bearer != null) request.header("Authorization", "Bearer " + bearer);
        if (json != null) request.header("Content-Type", "application/json");
        request.method(method, json == null ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofString(json));
        return HttpClient.newHttpClient().send(request.build(),
            HttpResponse.BodyHandlers.ofString());
    }
    private static void status(int expected, HttpResponse<String> response) {
        assertEquals(expected, response.statusCode(), response.body());
    }

    @Test
    void publicHealthAndMissingBearerRemainStrict() throws Exception {
        status(200, http("GET", "/health", null, null));
        status(401, http("GET", "/api/books", null, null));
        status(401, http("POST", "/api/books",
            "{\"isbn\":\"g4-no-auth\",\"title\":\"X\",\"stock\":0}", null));
        var basic = HttpRequest.newBuilder(URI.create(
            "http://127.0.0.1:" + port + "/api/books"))
            .header("Authorization", "Basic ZGVtbzpkZW1v").GET().build();
        status(401, HttpClient.newHttpClient().send(
            basic, HttpResponse.BodyHandlers.ofString()));
    }

    @Test
    void trustedScopesMapToCapabilitiesButClaimsCannotGrantThem() throws Exception {
        String reader = valid(READ);
        String writer = valid(WRITE);
        String both = valid(READ + " " + WRITE);
        status(200, http("GET", "/api/books?limit=1&offset=0", null, reader));
        status(403, http("POST", "/api/books",
            "{\"isbn\":\"g4-reader-denied\",\"title\":\"X\",\"stock\":0}", reader));
        status(403, http("PATCH", "/api/books/g4-reader-denied/stock",
            "{\"quantity\":1}", reader));
        status(403, http("GET", "/api/books", null, writer));
        status(201, http("POST", "/api/books",
            "{\"isbn\":\"g4-writer-only\",\"title\":\"Writable\",\"stock\":1}", writer));
        status(403, http("GET", "/api/books/g4-writer-only", null, writer));
        status(200, http("GET", "/api/books/g4-writer-only", null, both));
        status(200, http("PATCH", "/api/books/g4-writer-only/stock",
            "{\"quantity\":3}", writer));
        Instant now = Instant.now();
        String fakeCapability = jwt("something-else", ISSUER, AUDIENCE, now.minusSeconds(5),
            now.plusSeconds(300), now.minusSeconds(5), false, true);
        status(403, http("POST", "/api/books",
            "{\"isbn\":\"g4-fake-cap\",\"title\":\"X\",\"stock\":0}", fakeCapability));
        status(403, http("GET", "/api/books", null, fakeCapability));
    }

    @Test
    void issuerAudienceExpirationNbfAndSignatureAreVerified() throws Exception {
        Instant now = Instant.now();
        for (String invalid : List.of(
            jwt(READ, "https://evil.example.invalid", AUDIENCE,
                now.minusSeconds(6), now.plusSeconds(100), now.minusSeconds(6), false, false),
            jwt(READ, ISSUER, "some-other-service",
                now.minusSeconds(6), now.plusSeconds(100), now.minusSeconds(6), false, false),
            jwt(READ, ISSUER, AUDIENCE,
                now.minusSeconds(900), now.minusSeconds(600), now.minusSeconds(900), false, false),
            jwt(READ, ISSUER, AUDIENCE,
                now.minusSeconds(2), now.plusSeconds(300), now.plusSeconds(300), false, false),
            jwt(READ, ISSUER, AUDIENCE,
                now.minusSeconds(2), now.plusSeconds(300), now.minusSeconds(2), true, false),
            "not-a-jwt"
        )) {
            status(401, http("GET", "/api/books", null, invalid));
        }
        // Valid signature remains accepted after failed signature/claims attempts.
        status(200, http("GET", "/api/books", null, valid(READ)));
    }

    @Test
    void normalHttpErrorsAndInternalDispatchKeepCorrectCodes() throws Exception {
        String both = valid(READ + " " + WRITE);
        status(400, http("GET", "/api/books?limit=0", null, both));
        status(400, http("GET", "/api/books?limit=51", null, both));
        status(400, http("GET", "/api/books?limit=nonsense", null, both));
        status(404, http("GET", "/api/books/g4-not-found", null, both));
        status(403, http("GET", "/error", null, both));
        status(403, http("GET", "/api/not-registered", null, both));
        status(400, http("POST", "/api/books", "{broken", both));
        var body = "{\"isbn\":\"g4-duplicate\",\"title\":\"Test\",\"stock\":2}";
        status(201, http("POST", "/api/books", body, both));
        status(409, http("POST", "/api/books", body, both));
        status(200, http("PATCH", "/api/books/g4-duplicate/stock",
            "{\"quantity\":3}", both));
        status(400, http("PATCH", "/api/books/g4-duplicate/stock",
            "{\"quantity\":0}", both));
    }

    @Test
    @WithMockUser(authorities = "catalog.read")
    void methodInterceptorDeniesWriteEvenIfHttpLayerIsBypassed() {
        assertDoesNotThrow(() -> securedDomainPort.listBooks(1, 0));
        assertThrows(AccessDeniedException.class, () -> securedDomainPort.createBook(
            new BookRequest().isbn("g4-direct-reader-denied").title("DENIED").stock(1)));
    }

    @Test
    @WithMockUser(authorities = "catalog.write")
    void methodInterceptorDeniesReadEvenIfHttpLayerIsBypassed() {
        assertThrows(AccessDeniedException.class,
            () -> securedDomainPort.getBook("g4-direct-missing"));
        assertDoesNotThrow(() -> securedDomainPort.createBook(
            new BookRequest().isbn("g4-direct-writer-allowed").title("Allowed").stock(1)));
    }

    @Test
    void everyDomainWriteAndReadMethodCarriesDefenseInDepthAnnotation() throws Exception {
        var checks = java.util.Map.of(
            "createBook", "hasAuthority('catalog.write')",
            "adjustStock", "hasAuthority('catalog.write')",
            "getBook", "hasAuthority('catalog.read')",
            "listBooks", "hasAuthority('catalog.read')");
        for (var entry : checks.entrySet()) {
            var methods = java.util.Arrays.stream(BooksDelegate.class.getDeclaredMethods())
                .filter(m -> m.getName().equals(entry.getKey())).toList();
            assertEquals(1, methods.size(), entry.getKey());
            PreAuthorize auth = methods.getFirst().getAnnotation(PreAuthorize.class);
            assertNotNull(auth, entry.getKey());
            assertEquals(entry.getValue(), auth.value());
        }
    }
}
