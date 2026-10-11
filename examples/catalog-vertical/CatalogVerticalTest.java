package dev.protocolia.generated.custom;

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

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CatalogVerticalTest {
    @LocalServerPort int port;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private HttpResponse<String> call(String method, String path, String json, boolean authenticated) throws Exception {
        return callAs(method, path, json,
                authenticated ? System.getenv("PROTOCOLIA_USER") : null,
                authenticated ? System.getenv("PROTOCOLIA_PASSWORD") : null);
    }

    private HttpResponse<String> viewerCall(String method, String path, String json) throws Exception {
        return callAs(method, path, json,
                System.getenv("PROTOCOLIA_VIEWER_USER"),
                System.getenv("PROTOCOLIA_VIEWER_PASSWORD"));
    }

    private HttpResponse<String> callAs(String method, String path, String json, String user, String password) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(15));
        if (user != null) {
            String pair = user + ":" + password;
            request.header("Authorization", "Basic " + Base64.getEncoder().encodeToString(pair.getBytes(StandardCharsets.UTF_8)));
        }
        if (json != null) request.header("Content-Type", "application/json");
        request.method(method, json == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void generatedControllerUsesCustomHandlerAndKeepsValidationAndAuth() throws Exception {
        assertEquals(200, call("GET", "/health", null, false).statusCode());
        assertEquals(401, call("GET", "/api/books/anything", null, false).statusCode());

        String json = "{\"isbn\":\"catalog-port-1\",\"title\":\"Generated Route\",\"stock\":3}";
        var created = call("POST", "/api/books", json, true);
        assertEquals(201, created.statusCode(), created.body());
        assertTrue(created.body().contains("\"isbn\":\"catalog-port-1\""), created.body());

        var duplicate = call("POST", "/api/books",
                "{\"isbn\":\"catalog-port-1\",\"title\":\"Overwritten\",\"stock\":0}", true);
        assertEquals(409, duplicate.statusCode(), duplicate.body());
        var original = call("GET", "/api/books/catalog-port-1", null, true);
        assertEquals(200, original.statusCode(), original.body());
        assertTrue(original.body().contains("Generated Route"), original.body());
        assertEquals(200, viewerCall("GET", "/api/books/catalog-port-1", null).statusCode());
        assertEquals(403, viewerCall("POST", "/api/books",
                "{\"isbn\":\"viewer-try\",\"title\":\"Should be denied\",\"stock\":1}").statusCode());
        assertEquals(404, call("GET", "/api/books/viewer-try", null, true).statusCode());
        assertFalse(original.body().contains("Overwritten"), original.body());

        assertEquals(404, call("GET", "/api/books/missing", null, true).statusCode());
        assertEquals(400, call("POST", "/api/books", "{\"isbn\":\"bad\",\"title\":\"bad\",\"stock\":-1}", true).statusCode());
        assertEquals(400, call("POST", "/api/books", "{\"isbn\":\" \",\"title\":\"bad\",\"stock\":0}", true).statusCode());
        assertEquals(400, call("POST", "/api/books", "{\"isbn\":\"unknown\",\"title\":\"bad\",\"stock\":0,\"extra\":true}", true).statusCode());
        assertEquals(400, call("POST", "/api/books", "{bad json", true).statusCode());
    }
}
