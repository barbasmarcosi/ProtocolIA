# A0 generated app and PostgreSQL integration probe

From a clean checkout, run:

    docker build --progress=plain -f Dockerfile.a0-jhipster -t protocolia-a0-jhipster .

The isolated Docker build runs Java 21, Node 24, TypeSpec 1.17, JHipster 9.4 and ephemeral PostgreSQL 16. It compiles a generated Spring Boot JAR, starts it against the disposable database and checks HTTP JWT, generated CRUD, React HTML and explicit contract mismatches. The running public Render service only serves a verification marker, not the generated app. The test JWT credentials are JHipster defaults within the ephemeral container; do not reuse for production. A successful stock CRUD probe does not mean contractual parity or acceptance of A0.
