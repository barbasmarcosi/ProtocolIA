package dev.protocolia.domain;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class PostgresDomainContractTest {
    @Autowired BookInventory inventory;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager txManager;

    @Test
    void flywayMigrationsAndActualCheckConstraintExist() {
        Integer history = jdbc.queryForObject(
            "SELECT COUNT(*) FROM flyway_schema_history WHERE success = true", Integer.class);
        assertNotNull(history);
        assertTrue(history >= 1, "Flyway must apply reviewed V1 migration");
        String isbn = "g5-sqlcheck-" + UUID.randomUUID();
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
            () -> jdbc.update("INSERT INTO books(isbn,title,stock) VALUES (?,?,?)", isbn, "not allowed", -10));
        assertTrue(jdbc.queryForList("SELECT isbn FROM books WHERE isbn=?", String.class, isbn).isEmpty());
    }

    @Test
    void realTransactionRollbackCannotPersistBook() {
        String isbn = "g5-rollback-" + UUID.randomUUID();
        TransactionTemplate template = new TransactionTemplate(txManager);
        template.executeWithoutResult(status -> {
            inventory.create(isbn, "rollback must win", 1);
            assertEquals(1, inventory.get(isbn).stock());
            status.setRollbackOnly();
        });
        assertThrows(ResponseStatusException.class, () -> inventory.get(isbn));
        assertTrue(jdbc.queryForList("SELECT isbn FROM books WHERE isbn=?", String.class, isbn).isEmpty());
    }

    @Test
    void duplicateInsertAndOverflowKeepOriginalRow() {
        String isbn = "g5-invariant-" + UUID.randomUUID();
        inventory.create(isbn, "unchanged", Integer.MAX_VALUE);
        ResponseStatusException duplicate = assertThrows(ResponseStatusException.class,
            () -> inventory.create(isbn, "altered", 0));
        assertEquals(409, duplicate.getStatusCode().value());
        ResponseStatusException overflow = assertThrows(ResponseStatusException.class,
            () -> inventory.restock(isbn, 1));
        assertEquals(409, overflow.getStatusCode().value());
        assertEquals("unchanged", inventory.get(isbn).title());
        assertEquals(Integer.MAX_VALUE, inventory.get(isbn).stock());
    }
}
