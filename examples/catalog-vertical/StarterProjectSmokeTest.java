package dev.protocolia.generated.custom;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.assertEquals;

/** The generic initialized project must never fake implemented business behavior. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StarterProjectSmokeTest {
    @LocalServerPort int port;

    @Test
    void scaffoldIsRunnableButDoesNotPretendToImplementTheContract() throws Exception {
        var client = HttpClient.newHttpClient();
        var url = URI.create("http://127.0.0.1:" + port + "/api/books/nonexistent");
        assertEquals(401, client.send(HttpRequest.newBuilder(url).GET().build(),
                HttpResponse.BodyHandlers.ofString()).statusCode());
        String basic = System.getenv("PROTOCOLIA_USER") + ":" + System.getenv("PROTOCOLIA_PASSWORD");
        var req = HttpRequest.newBuilder(url)
                .header("Authorization", "Basic " +
                        Base64.getEncoder().encodeToString(basic.getBytes(StandardCharsets.UTF_8)))
                .GET().build();
        var response = client.send(req, HttpResponse.BodyHandlers.ofString());
        assertEquals(501, response.statusCode(), response.body());
    }
}
