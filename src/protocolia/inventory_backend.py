"""One explicit, verified inventory-sale profile, not arbitrary generated business rules.

The contract's full supported model/operation shape is checked before attaching
this named transactional template. Unknown templates/fields never silently execute.
"""
from __future__ import annotations
from .core import ContractError, _fail
from .v02 import validate
from .java_spring import generate_java, SRC

MODEL_FIELDS = {
 "Health":{"status":("string",True)},
 "ProductCreate":{"sku":("string",True),"quantity":("integer",True)},
 "Product":{"id":("uuid",True),"sku":("string",True),"quantity":("integer",True)},
 "StockResponse":{"product_id":("uuid",True),"stock":("integer",True)},
 "SaleRequest":{"product_id":("uuid",True),"quantity":("integer",True),"idempotency_key":("uuid",True)},
 "SaleResponse":{"id":("uuid",True),"product_id":("uuid",True),"quantity":("integer",True),"status":("string",True)}
}
OPERATIONS = {
 "health":("GET","/health",None,"Health","public",{}),
 "createProduct":("POST","/products","ProductCreate","Product","products.write",{}),
 "getStock":("GET","/products/{product_id}/stock",None,"StockResponse","products.read",{"product_id":"uuid"}),
 "registerSale":("POST","/sales","SaleRequest","SaleResponse","sales.create",{})
}

CONTROLLER="""package dev.protocolia.generated;
@org.springframework.web.bind.annotation.RestController
public class ContractController {
    private final InventoryService inventory;
    public ContractController(InventoryService inventory) { this.inventory=inventory; }
    @org.springframework.web.bind.annotation.GetMapping("/health")
    public Health health() { return new Health("ok"); }

    @org.springframework.security.access.prepost.PreAuthorize("hasAuthority('products.write')")
    @org.springframework.web.bind.annotation.PostMapping("/products")
    public Product createProduct(@jakarta.validation.Valid @org.springframework.web.bind.annotation.RequestBody ProductCreate body) {
        return inventory.createProduct(body);
    }

    @org.springframework.security.access.prepost.PreAuthorize("hasAuthority('products.read')")
    @org.springframework.web.bind.annotation.GetMapping("/products/{product_id}/stock")
    public StockResponse getStock(@org.springframework.web.bind.annotation.PathVariable("product_id") java.util.UUID id) {
        return inventory.stock(id);
    }

    @org.springframework.security.access.prepost.PreAuthorize("hasAuthority('sales.create')")
    @org.springframework.web.bind.annotation.PostMapping("/sales")
    public SaleResponse registerSale(@jakarta.validation.Valid @org.springframework.web.bind.annotation.RequestBody SaleRequest body) {
        return inventory.sale(body);
    }
}
"""
SERVICE="""package dev.protocolia.generated;

import java.util.UUID;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.server.ResponseStatusException;

@Service
public class InventoryService {
    private final JdbcTemplate db;
    public InventoryService(JdbcTemplate db) { this.db=db; }

    @Transactional
    public Product createProduct(ProductCreate req) {
        UUID id=UUID.randomUUID();
        try {
            db.update("INSERT INTO products(id,sku,stock) VALUES (?,?,?)", id,req.sku(),req.quantity());
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,"duplicate sku",e);
        }
        return new Product(id,req.quantity(),req.sku());
    }

    @Transactional(readOnly=true)
    public StockResponse stock(UUID productId) {
        List<Integer> rows=db.query("SELECT stock FROM products WHERE id = ?",
                (rs,row)->rs.getInt("stock"), productId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"product not found");
        return new StockResponse(productId,rows.get(0));
    }

    @Transactional
    public SaleResponse sale(SaleRequest req) {
        if (req.quantity()==null || req.quantity()<1 || req.quantity()>1000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"quantity out of supported range");
        if (stockExists(req.product_id())==false)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"product not found");
        UUID id=UUID.randomUUID();
        int inserted=db.update("INSERT INTO sales(id,idempotency_key,product_id,quantity,state) "
                +"VALUES (?,?,?,?, 'PENDING') ON CONFLICT(idempotency_key) DO NOTHING",
                id,req.idempotency_key(),req.product_id(),req.quantity());
        if (inserted==0) {
            List<SaleResponse> existing=db.query("SELECT id,product_id,quantity,state FROM sales WHERE idempotency_key=?",
                (rs,row)->new SaleResponse((UUID)rs.getObject("id"),(UUID)rs.getObject("product_id"),
                                           rs.getInt("quantity"),rs.getString("state")), req.idempotency_key());
            if (existing.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT,"idempotency race");
            SaleResponse prior=existing.get(0);
            if (!prior.product_id().equals(req.product_id()) || prior.quantity()!=req.quantity())
                throw new ResponseStatusException(HttpStatus.CONFLICT,"idempotency key reused for different request");
            if (!"COMPLETED".equals(prior.status()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,"previous request incomplete");
            return prior;
        }
        int affected=db.update("UPDATE products SET stock = stock - ? WHERE id=? AND stock>=?",
                               req.quantity(),req.product_id(),req.quantity());
        if (affected!=1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"insufficient stock");
        db.update("UPDATE sales SET state='COMPLETED' WHERE id=?",id);
        return new SaleResponse(id,req.product_id(),req.quantity(),"COMPLETED");
    }

    private boolean stockExists(UUID id) {
        Integer count=db.queryForObject("SELECT COUNT(*) FROM products WHERE id=?",Integer.class,id);
        return count!=null && count!=0;
    }
}
"""
MIGRATION="""CREATE TABLE products (
    id UUID PRIMARY KEY,
    sku VARCHAR(48) NOT NULL UNIQUE,
    stock INTEGER NOT NULL CHECK(stock >= 0)
);
CREATE TABLE sales (
    id UUID PRIMARY KEY,
    idempotency_key UUID NOT NULL UNIQUE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    state VARCHAR(16) NOT NULL CHECK(state IN ('PENDING','COMPLETED'))
);
CREATE INDEX sales_product_id_idx ON sales(product_id);
"""
INTEGRATION_TEST="package dev.protocolia.generated;\nimport java.util.UUID;\nimport java.util.concurrent.Executors;\nimport java.util.concurrent.Future;\nimport org.junit.jupiter.api.AfterAll;\nimport org.junit.jupiter.api.Test;\nimport org.springframework.beans.factory.annotation.Autowired;\nimport org.springframework.boot.test.context.SpringBootTest;\nimport org.springframework.jdbc.core.JdbcTemplate;\nimport org.springframework.test.context.DynamicPropertyRegistry;\nimport org.springframework.test.context.DynamicPropertySource;\nimport org.springframework.web.server.ResponseStatusException;\nimport org.testcontainers.containers.PostgreSQLContainer;\nimport static org.junit.jupiter.api.Assertions.*;\n\n@SpringBootTest(properties={\"spring.flyway.enabled=true\",\"spring.main.web-application-type=none\"})\nclass InventoryPostgresTest {\n    static final PostgreSQLContainer<?> db=new PostgreSQLContainer<>(\"postgres:16-alpine\");\n    static { db.start(); }\n    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {\n        registry.add(\"spring.datasource.url\", db::getJdbcUrl);\n        registry.add(\"spring.datasource.username\", db::getUsername);\n        registry.add(\"spring.datasource.password\", db::getPassword);\n    }\n    @AfterAll static void closeContainer() { db.stop(); }\n    @Autowired InventoryService inventory;\n    @Autowired JdbcTemplate jdbc;\n\n    @Test void atomicStockRaceAllowsOnlyOneSale() throws Exception {\n        Product product=inventory.createProduct(new ProductCreate(1,\"race\"+UUID.randomUUID().toString().replace(\"-\",\"\")));\n        UUID key1=UUID.randomUUID(),key2=UUID.randomUUID();\n        var pool=Executors.newFixedThreadPool(2);\n        try {\n            Future<Boolean> f1=pool.submit(()->buy(product.id(),key1));\n            Future<Boolean> f2=pool.submit(()->buy(product.id(),key2));\n            assertEquals(1,(f1.get()?1:0)+(f2.get()?1:0));\n            assertEquals(0,inventory.stock(product.id()).stock());\n        } finally { pool.shutdownNow(); }\n    }\n    private boolean buy(UUID product, UUID key) {\n        try {\n            return \"COMPLETED\".equals(inventory.sale(new SaleRequest(key,product,1)).status());\n        } catch(ResponseStatusException e) {\n            assertEquals(409,e.getStatusCode().value());\n            return false;\n        }\n    }\n    @Test void failedSaleRollsBackIdempotencyReservation() {\n        Product product=inventory.createProduct(new ProductCreate(0,\"rollback\"+UUID.randomUUID().toString().replace(\"-\",\"\")));\n        UUID key=UUID.randomUUID();\n        ResponseStatusException error=assertThrows(ResponseStatusException.class,\n                ()->inventory.sale(new SaleRequest(key,product.id(),1)));\n        assertEquals(409,error.getStatusCode().value());\n        Integer count=jdbc.queryForObject(\"SELECT COUNT(*) FROM sales WHERE idempotency_key=?\",Integer.class,key);\n        assertEquals(0,count);\n        assertEquals(0,inventory.stock(product.id()).stock());\n    }\n    @Test void replayUsesSingleSaleAndSingleStockMovement() {\n        Product product=inventory.createProduct(new ProductCreate(2,\"replay\"+UUID.randomUUID().toString().replace(\"-\",\"\")));\n        UUID key=UUID.randomUUID();\n        SaleRequest command=new SaleRequest(key,product.id(),1);\n        var first=inventory.sale(command);\n        var second=inventory.sale(command);\n        assertEquals(first.id(),second.id());\n        assertEquals(1,inventory.stock(product.id()).stock());\n        Integer count=jdbc.queryForObject(\"SELECT COUNT(*) FROM sales WHERE idempotency_key=?\",Integer.class,key);\n        assertEquals(1,count);\n        assertEquals(409,assertThrows(ResponseStatusException.class,\n                ()->inventory.sale(new SaleRequest(key,product.id(),2))).getStatusCode().value());\n    }\n}\n"

def generate_inventory(contract: dict) -> dict[str,str]:
    ir=validate(contract)
    if ir["version"]!="0.2" or set(ir["models"])!=set(MODEL_FIELDS) or set(ir["operations"])!=set(OPERATIONS):
        _fail("inventory-sale: unexpected contract models/operations")
    for model,expected in MODEL_FIELDS.items():
        fields=ir["models"][model]
        if set(fields)!=set(expected):
            _fail("inventory-sale: unexpected fields in "+model)
        for name,(kind,required) in expected.items():
            actual=fields[name]
            if actual["type"]!=kind or actual["required"] is not required:
                _fail("inventory-sale: unexpected field "+model+"."+name)
    # Supported semantics depend on these exact runtime bounds.
    p=ir["models"]["ProductCreate"]
    q=ir["models"]["SaleRequest"]
    if p["quantity"].get("constraints")!={"minimum":0} or q["quantity"].get("constraints")!={"minimum":1,"maximum":1000}:
        _fail("inventory-sale: unsupported stock/sale bounds")
    for name, (method,path,request,response,capability,params) in OPERATIONS.items():
        o=ir["operations"][name]
        if (o["method"],o["path"],o.get("request"),o["response"],o["capability"],o["params"])!=(method,path,request,response,capability,params):
            _fail("inventory-sale: incompatible endpoint "+name)
    out=generate_java(contract)
    out[SRC+"ContractController.java"]=CONTROLLER
    out[SRC+"InventoryService.java"]=SERVICE
    out["src/main/resources/db/migration/V1__inventory.sql"]=MIGRATION
    out["pom.xml"]=out["pom.xml"].replace("</dependencies>",'''<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-jdbc</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-flyway</artifactId></dependency>
<dependency><groupId>org.flywaydb</groupId><artifactId>flyway-database-postgresql</artifactId></dependency>
<dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><scope>runtime</scope></dependency>
</dependencies>''')
    out["src/main/resources/application.properties"] += """
spring.datasource.url=${DATABASE_URL}
spring.datasource.username=${DATABASE_USER}
spring.datasource.password=${DATABASE_PASSWORD}
spring.flyway.enabled=${PROTOCOLIA_ENABLE_MIGRATIONS:false}
"""
    out["src/test/java/dev/protocolia/generated/InventoryPostgresTest.java"]=INTEGRATION_TEST
    out["pom.xml"]=out["pom.xml"].replace("</dependencies>", "<dependency><groupId>org.testcontainers</groupId><artifactId>postgresql</artifactId><version>1.21.4</version><scope>test</scope></dependency></dependencies>")
    out["README.md"]="Generated bounded inventory-sale Java 21 / Spring Boot service. Never enable Flyway on production without reviewing SQL. Provide DATABASE_URL/USER/PASSWORD, PROTOCOLIA_ENABLE_MIGRATIONS=true only in a disposable database, and PROTOCOLIA_USER/PASSWORD/SCOPES. Idempotency is scoped to a UUID key. No production identity provider, no generic business-language inference.\n"
    return dict(sorted(out.items()))
