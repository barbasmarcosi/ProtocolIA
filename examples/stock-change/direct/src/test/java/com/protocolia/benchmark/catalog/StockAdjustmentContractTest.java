package com.protocolia.benchmark.catalog;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StockAdjustmentContractTest {
    @LocalServerPort int port;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();

    private HttpResponse<String> send(String method, String path, String body, String account) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(20));
        if (account != null) {
            String user = System.getenv("PROTOCOLIA_" + account + (account.equals("VIEWER") ? "_USER" : ""));
            String password = System.getenv(account.equals("VIEWER")
                    ? "PROTOCOLIA_VIEWER_PASSWORD" : "PROTOCOLIA_PASSWORD");
            if (account.equals("USER")) user = System.getenv("PROTOCOLIA_USER");
            String value = user + ":" + password;
            request.header("Authorization", "Basic " +
                    Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8)));
        }
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> owner(String method, String path, String body) throws Exception {
        return send(method, path, body, "USER");
    }
    private HttpResponse<String> viewer(String method, String path, String body) throws Exception {
        return send(method, path, body, "VIEWER");
    }

    @Test
    void restockIsValidatedAuthorizedAndPreservesStateOnFailures() throws Exception {
        String isbn = "stock-stage4-001";
        String url = "/api/books/" + isbn;
        assertEquals(201, owner("POST", "/api/books",
                "{\"isbn\":\"" + isbn + "\",\"title\":\"Original\",\"stock\":4}").statusCode());
        assertEquals(401, send("PATCH", url + "/stock", "{\"quantity\":1}", null).statusCode());
        assertEquals(200, viewer("GET", url, null).statusCode());
        assertEquals(403, viewer("PATCH", url + "/stock", "{\"quantity\":1}").statusCode());
        var updated = owner("PATCH", url + "/stock", "{\"quantity\":7}");
        assertEquals(200, updated.statusCode(), updated.body());
        assertTrue(updated.body().contains("\"stock\":11"), updated.body());
        assertTrue(updated.body().contains("\"title\":\"Original\""), updated.body());
        for (String invalid : new String[] {
                "{\"quantity\":0}", "{\"quantity\":-1}", "{\"quantity\":1001}",
                "{\"quantity\":1,\"unknown\":true}", "{broken",
                "{\"quantity\":null}", "{\"quantity\":\"bad\"}"
        }) {
            var response = owner("PATCH", url + "/stock", invalid);
            assertEquals(400, response.statusCode(), "payload=" + invalid + " response=" + response.body());
        }
        assertEquals(200, owner("GET", url, null).statusCode());
        var unchanged = owner("GET", url, null);
        assertTrue(unchanged.body().contains("\"stock\":11"), unchanged.body());
        assertEquals(404, owner("PATCH", "/api/books/no-book/stock", "{\"quantity\":2}").statusCode());

        assertEquals(201, owner("POST", "/api/books",
                "{\"isbn\":\"stock-overflow-001\",\"title\":\"Limit\",\"stock\":2147483647}").statusCode());
        assertEquals(409, owner("PATCH", "/api/books/stock-overflow-001/stock",
                "{\"quantity\":1}").statusCode());
        assertTrue(owner("GET", "/api/books/stock-overflow-001", null).body()
                .contains("\"stock\":2147483647"));
    }

    @Test
    void parallelRestocksCannotLoseUpdates() throws Exception {
        String isbn = "stock-parallel-001";
        assertEquals(201, owner("POST", "/api/books",
                "{\"isbn\":\"" + isbn + "\",\"title\":\"Parallel\",\"stock\":0}").statusCode());
        var executor = Executors.newFixedThreadPool(6);
        try {
            List<java.util.concurrent.Future<Integer>> responses = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                responses.add(executor.submit(() ->
                        owner("PATCH", "/api/books/" + isbn + "/stock", "{\"quantity\":3}").statusCode()));
            }
            for (var response : responses) {
                assertEquals(200, response.get(30, TimeUnit.SECONDS).intValue());
            }
        } finally {
            executor.shutdownNow();
        }
        var read = owner("GET", "/api/books/" + isbn, null);
        assertEquals(200, read.statusCode());
        assertTrue(read.body().contains("\"stock\":24"), read.body());
    }
}
