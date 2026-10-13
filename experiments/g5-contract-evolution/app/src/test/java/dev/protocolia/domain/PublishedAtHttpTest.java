package dev.protocolia.domain;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class PublishedAtHttpTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private HttpResponse<String> call(String method, String path, String json) throws Exception {
        String credentials = System.getenv("PROTOCOLIA_USER")+":"+System.getenv("PROTOCOLIA_PASSWORD");
        var req = HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path))
            .timeout(Duration.ofSeconds(15))
            .header("Authorization","Basic "+Base64.getEncoder().encodeToString(
                credentials.getBytes(StandardCharsets.UTF_8)));
        if(json!=null) req.header("Content-Type","application/json");
        req.method(method, json==null?HttpRequest.BodyPublishers.noBody():
            HttpRequest.BodyPublishers.ofString(json));
        return http.send(req.build(),HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void publishedAtRoundTripsAndRestockPreservesIt() throws Exception {
        String isbn = "v04-roundtrip-"+UUID.randomUUID();
        String when = "2026-10-12T10:30:00Z";
        String body = "{\"isbn\":\""+isbn+"\",\"title\":\"Evolved\",\"stock\":2,\"publishedAt\":\""+when+"\"}";
        var create = call("POST","/api/books",body);
        assertEquals(201,create.statusCode(),create.body());
        assertTrue(create.body().contains("publishedAt"),create.body());
        assertEquals(OffsetDateTime.parse(when),
            jdbc.queryForObject("SELECT published_at FROM books WHERE isbn = ?",
                (rs,i)->rs.getObject(1,OffsetDateTime.class),isbn));
        var update = call("PATCH","/api/books/"+isbn+"/stock","{\"quantity\":7}");
        assertEquals(200,update.statusCode(),update.body());
        var detail = call("GET","/api/books/"+isbn,null);
        assertEquals(200,detail.statusCode(),detail.body());
        assertTrue(detail.body().contains("publishedAt"),detail.body());
        assertTrue(detail.body().contains("2026-10-12"),detail.body());
        assertTrue(detail.body().contains("\"stock\":9"),detail.body());
        var page = call("GET","/api/books?limit=50&offset=0",null);
        assertEquals(200,page.statusCode(),page.body());
        assertTrue(page.body().contains(isbn),page.body());
    }

    @Test
    void omissionAndExplicitNullAndBadTimestamp() throws Exception {
        String isbn = "v04-omitted-"+UUID.randomUUID();
        assertEquals(201,call("POST","/api/books",
            "{\"isbn\":\""+isbn+"\",\"title\":\"Omitted\",\"stock\":0}").statusCode());
        assertNull(jdbc.queryForObject("SELECT published_at FROM books WHERE isbn = ?",
            (rs,i)->rs.getObject(1,OffsetDateTime.class),isbn));
        assertEquals(201,call("POST","/api/books",
            "{\"isbn\":\"v04-null-"+UUID.randomUUID()+"\",\"title\":\"Null\",\"stock\":1,\"publishedAt\":null}").statusCode());
        assertEquals(400,call("POST","/api/books",
            "{\"isbn\":\"v04-invalid-"+UUID.randomUUID()+"\",\"title\":\"Bad\",\"stock\":1,\"publishedAt\":\"not-a-date\"}").statusCode());
    }

    @Test
    void titleMutationIsPersistentAndFailClosed() throws Exception {
        String isbn="g5-v04-title-"+UUID.randomUUID();
        assertEquals(201,call("POST","/api/books",
            "{\"isbn\":\""+isbn+"\",\"title\":\"Original\",\"stock\":2}").statusCode());
        var renamed=call("PATCH","/api/books/"+isbn+"/title",
            "{\"title\":\"Renamed book\"}");
        assertEquals(200,renamed.statusCode(),renamed.body());
        assertEquals("Renamed book",jdbc.queryForObject(
            "SELECT title FROM books WHERE isbn = ?",String.class,isbn));
        assertEquals(400,call("PATCH","/api/books/"+isbn+"/title",
            "{\"title\":\"   \"}").statusCode());
        assertEquals(404,call("PATCH","/api/books/no-such-book/title",
            "{\"title\":\"Valid title\"}").statusCode());
    }

    @Test
    void reviewedFlywayV2AppliedWithoutDestroyingLegacyRows() {
        assertEquals(1,jdbc.queryForObject(
            "SELECT COUNT(*) FROM flyway_schema_history WHERE version = '2' AND success = true",
            Integer.class));
        jdbc.update("INSERT INTO books(isbn,title,stock) VALUES (?,?,?)",
            "v04-legacy-"+UUID.randomUUID(),"Legacy",1);
    }
}
