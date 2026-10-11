package com.protocolia.catalog;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class CatalogControllerTest {
    @Autowired
    private MockMvc mvc;

    @Test
    void createsBookAndPreservesOriginalOnDuplicate() throws Exception {
        String book = "{\"isbn\":\"978-1\",\"title\":\"Catalog Design\",\"stock\":7}";
        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON).content(book))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.isbn").value("978-1"))
                .andExpect(jsonPath("$.title").value("Catalog Design"))
                .andExpect(jsonPath("$.stock").value(7));
        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON).content(book))
                .andExpect(status().isConflict());
        mvc.perform(get("/api/books/978-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stock").value(7));
    }

    @Test
    void rejectsBadPayloadsAndExposesHealth() throws Exception {
        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isbn\":\"\",\"title\":\"\",\"stock\":-1}"))
                .andExpect(status().is4xxClientError());
        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isbn\":\"978-2\",\"title\":\"Unknown\",\"stock\":1,\"extra\":true}"))
                .andExpect(status().is4xxClientError());
        mvc.perform(get("/api/books/not-found")).andExpect(status().isNotFound());
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }
}
