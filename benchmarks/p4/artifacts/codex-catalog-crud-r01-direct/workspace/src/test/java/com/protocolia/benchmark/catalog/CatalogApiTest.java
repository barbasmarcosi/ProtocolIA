package com.protocolia.benchmark.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CatalogApiTest {
    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    @Test
    void createsReadsAndRejectsDuplicateIsbn() {
        ResponseEntity<Map> created = post("{\"isbn\":\"direct-001\",\"title\":\"Direct Catalog\",\"stock\":4}");
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(created.getBody()).containsEntry("isbn", "direct-001").containsEntry("stock", 4);

        ResponseEntity<Map> duplicate = post("{\"isbn\":\"direct-001\",\"title\":\"Changed\",\"stock\":0}");
        assertThat(duplicate.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        ResponseEntity<Map> stored = rest.getForEntity(url("/api/books/direct-001"), Map.class);
        assertThat(stored.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(stored.getBody()).containsEntry("title", "Direct Catalog").containsEntry("stock", 4);
    }

    @Test
    void rejectsInvalidPayloadsAndReportsHealth() {
        assertThat(post("{\"isbn\":\"\",\"title\":\"\",\"stock\":-1}").getStatusCode().is4xxClientError()).isTrue();
        assertThat(post("{\"isbn\":\"direct-002\",\"title\":\"Unknown\",\"stock\":2,\"extra\":true}").getStatusCode().is4xxClientError()).isTrue();
        assertThat(rest.getForEntity(url("/api/books/absent"), String.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(rest.getForEntity(url("/actuator/health"), String.class).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private ResponseEntity<Map> post(String json) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.postForEntity(url("/api/books"), new HttpEntity<>(json, headers), Map.class);
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }
}
