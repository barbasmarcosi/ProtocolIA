package dev.protocolia.domain;

import static org.junit.jupiter.api.Assertions.*;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import dev.protocolia.upstream.api.BooksApiDelegate;
import dev.protocolia.upstream.api.DefaultApiDelegate;

/** Reject generated default methods returning 501 as "implemented" operations. */
class DelegateCompletenessTest {
    @Test
    void everyRequiredOperationIsOverriddenInHandwrittenDelegate() throws Exception {
        for (Method m : BooksApiDelegate.class.getMethods()) {
            if (!java.util.Set.of("adjustStock", "createBook", "getBook", "listBooks").contains(m.getName())) continue;
            Method actual = BooksDelegate.class.getMethod(m.getName(), m.getParameterTypes());
            assertEquals(BooksDelegate.class, actual.getDeclaringClass(),
                "Unimplemented operation still has generated 501 default: " + m.getName());
        }
        Method health = DefaultApiDelegate.class.getMethod("health");
        assertEquals(HealthDelegate.class,
            HealthDelegate.class.getMethod("health", health.getParameterTypes()).getDeclaringClass());
    }
}
