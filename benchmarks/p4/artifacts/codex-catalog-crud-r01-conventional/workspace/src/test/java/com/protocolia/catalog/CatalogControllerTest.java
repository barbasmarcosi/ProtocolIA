package com.protocolia.catalog;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CatalogControllerTest {
    @Autowired
    private MockMvc mvc;

    @Test
    void createsReadsAndProtectsABook() throws Exception {
        String payload = "{\"isbn\":\"isbn-1\",\"title\":\"Domain-Driven Design\",\"stock\":2}";

        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.isbn").value("isbn-1"))
                .andExpect(jsonPath("$.title").value("Domain-Driven Design"))
                .andExpect(jsonPath("$.stock").value(2));

        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isConflict());

        mvc.perform(get("/api/books/isbn-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stock").value(2));
    }

    @Test
    void rejectsInvalidAndUnknownPayloadsAndReportsHealth() throws Exception {
        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isbn\":\"\",\"title\":\"\",\"stock\":-1}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isbn\":\"isbn-without-stock\",\"title\":\"Incomplete\"}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/books").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isbn\":\"isbn-2\",\"title\":\"Clean Code\",\"stock\":1,\"extra\":true}"))
                .andExpect(status().isBadRequest());

        mvc.perform(get("/api/books/missing"))
                .andExpect(status().isNotFound());

        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }
}
