package dev.protocolia.generated.custom;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BooksPaginationHttpTest {
    @LocalServerPort int port;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private HttpResponse<String> call(String method, String path, String body, String identity) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(15));
        if (identity != null) {
            boolean viewer = "VIEWER".equals(identity);
            String user = System.getenv(viewer ? "PROTOCOLIA_VIEWER_USER" : "PROTOCOLIA_USER");
            String pass = System.getenv(viewer ? "PROTOCOLIA_VIEWER_PASSWORD" : "PROTOCOLIA_PASSWORD");
            String token = Base64.getEncoder().encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8));
            request.header("Authorization", "Basic " + token);
        }
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() :
                HttpRequest.BodyPublishers.ofString(body));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private int number(String body, String field) {
        Matcher m = Pattern.compile(field + "\\s*:\\s*(\\d+)").matcher(body);
        assertTrue(m.find(), "Missing numeric field " + field + " in " + body);
        return Integer.parseInt(m.group(1));
    }

    @Test
    void boundedPaginationAndStableSortUseRealHandler() throws Exception {
        var before = call("GET", "/api/books", null, "USER");
        assertEquals(200, before.statusCode(), before.body());
        int initial = number(before.body(), "total");
        String prefix = "paging-v03-test-";
        for (String suffix : new String[] {"z", "a", "m"}) {
            var created = call("POST", "/api/books",
                "{\"isbn\":\"" + prefix + suffix + "\",\"title\":\"Pagination\",\"stock\":2}", "USER");
            assertEquals(201, created.statusCode(), created.body());
        }
        var all = call("GET", "/api/books?limit=50&offset=0", null, "USER");
        assertEquals(200, all.statusCode(), all.body());
        assertEquals(initial + 3, number(all.body(), "total"));
        assertEquals(50, number(all.body(), "limit"));
        assertEquals(0, number(all.body(), "offset"));
        assertTrue(all.body().indexOf(prefix + "a") < all.body().indexOf(prefix + "m"), all.body());
        assertTrue(all.body().indexOf(prefix + "m") < all.body().indexOf(prefix + "z"), all.body());

        var second = call("GET", "/api/books?limit=1&offset=1", null, "USER");
        assertEquals(200, second.statusCode(), second.body());
        assertEquals(1, number(second.body(), "limit"));
        assertEquals(1, number(second.body(), "offset"));
        assertEquals(initial + 3, number(second.body(), "total"));
        // Only one Book is returned by a page of size one.
        assertEquals(1, second.body().split("isbn").length - 1, second.body());

        var beyond = call("GET", "/api/books?limit=1&offset=1000000", null, "USER");
        assertEquals(200, beyond.statusCode(), beyond.body());
        assertTrue(beyond.body().contains("\"items\":[]"), beyond.body());
        assertEquals(initial + 3, number(beyond.body(), "total"));
        var defaults = call("GET", "/api/books", null, "USER");
        assertEquals(200, defaults.statusCode());
        assertEquals(25, number(defaults.body(), "limit"));
        assertEquals(0, number(defaults.body(), "offset"));
    }

    @Test
    void boundsAndAuthorizationAreServerSide() throws Exception {
        assertEquals(401, call("GET", "/api/books", null, null).statusCode());
        assertEquals(200, call("GET", "/api/books?limit=2", null, "VIEWER").statusCode());
        assertEquals(403, call("POST", "/api/books",
                "{\"isbn\":\"paging-viewer-should-not-write\",\"title\":\"No\",\"stock\":1}", "VIEWER").statusCode());

        for (String invalid : new String[] {
                "limit=0", "limit=51", "limit=-1", "limit=nope",
                "offset=-1", "offset=1000001", "offset=invalid"
        }) {
            var result = call("GET", "/api/books?" + invalid, null, "USER");
            assertEquals(400, result.statusCode(), invalid + " -> " + result.body());
        }
        assertEquals(200, call("GET", "/api/books?limit=1&offset=0", null, "USER").statusCode());
    }
}
