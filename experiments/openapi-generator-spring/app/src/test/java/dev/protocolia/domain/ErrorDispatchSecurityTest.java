package dev.protocolia.domain;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.*;

/** Security regression: allow internal ERROR dispatches without opening /error. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ErrorDispatchSecurityTest {
    @LocalServerPort int port;

    private int get(String path) throws Exception {
        String auth = System.getenv("PROTOCOLIA_USER") + ":" + System.getenv("PROTOCOLIA_PASSWORD");
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("Authorization", "Basic " +
                Base64.getEncoder().encodeToString(auth.getBytes(StandardCharsets.UTF_8)))
            .timeout(Duration.ofSeconds(15))
            .GET().build();
        return HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()).statusCode();
    }

    @Test
    void directErrorRequestIsForbiddenButInternalErrorDispatchKeepsStatus() throws Exception {
        assertEquals(403, get("/error"));
        assertEquals(403, get("/api/unknown"));
        assertEquals(400, get("/api/books?limit=0"));
        assertEquals(400, get("/api/books?limit=nope"));
        assertEquals(200, get("/api/books?limit=1&offset=0"));
    }
}
