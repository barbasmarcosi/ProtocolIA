package com.protocolia.benchmark.catalog;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CatalogApiTest {
    @LocalServerPort int port;

    private HttpResponse<String> call(String method, String path, String body) throws Exception {
        var client = HttpClient.newHttpClient();
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        String basic = System.getenv("PROTOCOLIA_USER") + ":" + System.getenv("PROTOCOLIA_PASSWORD");
        request.header("Authorization", "Basic " +
                Base64.getEncoder().encodeToString(basic.getBytes(StandardCharsets.UTF_8)));
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void createReadDuplicateNotFoundInvalidJsonAndHealth() throws Exception {
        var client = HttpClient.newHttpClient();
        assertEquals(200, client.send(HttpRequest.newBuilder(URI.create(
                "http://127.0.0.1:" + port + "/actuator/health")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).statusCode());
        var created = call("POST", "/api/books", "{\"isbn\":\"direct-base\",\"title\":\"Baseline\",\"stock\":2}");
        assertEquals(201, created.statusCode(), created.body());
        assertEquals(409, call("POST", "/api/books",
                "{\"isbn\":\"direct-base\",\"title\":\"Changed\",\"stock\":0}").statusCode());
        var original = call("GET", "/api/books/direct-base", null);
        assertEquals(200, original.statusCode(), original.body());
        assertTrue(original.body().contains("\"title\":\"Baseline\""), original.body());
        assertEquals(404, call("GET", "/api/books/missing", null).statusCode());
        assertEquals(400, call("POST", "/api/books",
                "{\"isbn\":\"bad\",\"title\":\"Bad\",\"stock\":-1}").statusCode());
        assertEquals(400, call("POST", "/api/books",
                "{\"isbn\":\"bad\",\"title\":\"Bad\",\"stock\":1,\"extra\":true}").statusCode());
    }
}
