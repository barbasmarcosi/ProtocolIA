# G5: strict, disposable PostgreSQL 16 + Flyway persistence test.
# The database exists ONLY inside the Docker build; never deploy a public DB.
FROM python:3.13-slim AS canonical-contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/books-paging-v03/contract.json ./examples/books-paging-v03/contract.json
COPY examples/books-paging-v03/resources.json ./examples/books-paging-v03/resources.json
COPY examples/books-paging-v03/http-errors.json ./examples/books-paging-v03/http-errors.json
RUN PYTHONPATH=src python -m protocolia compile-bundle \
    examples/books-paging-v03/contract.json --profile java-spring-basic-demo \
    --resources examples/books-paging-v03/resources.json \
    --domain-errors examples/books-paging-v03/http-errors.json --out /contract-bundle

FROM maven:3.9.11-eclipse-temurin-21 AS generator
WORKDIR /gen
COPY --from=canonical-contract /contract-bundle/openapi.json ./openapi.json
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy \
    -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar -DoutputDirectory=/tools
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
    -g spring -i /gen/openapi.json -o /gen/upstream \
    --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
    --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java
RUN echo G5_PINNED_OPENAPI_7_26_0_GENERATED

# Packaging Maven + JDK into a PostgreSQL image permits real database tests
# in a single disposable Docker RUN, with no Docker daemon, socket or payment.
FROM postgres:16.10-bookworm AS database-tests
COPY --from=maven:3.9.11-eclipse-temurin-21 /opt/java/openjdk /opt/java/openjdk
COPY --from=maven:3.9.11-eclipse-temurin-21 /usr/share/maven /usr/share/maven
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:/usr/share/maven/bin:/usr/lib/postgresql/16/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work/app
COPY experiments/g5-postgresql-books/app/pom.xml ./pom.xml
COPY --from=generator /gen/upstream/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/Application.java ./src/main/java/dev/protocolia/Application.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/domain/BooksDelegate.java ./src/main/java/dev/protocolia/domain/BooksDelegate.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/domain/HealthDelegate.java ./src/main/java/dev/protocolia/domain/HealthDelegate.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/security/DemoSecurity.java ./src/main/java/dev/protocolia/security/DemoSecurity.java
COPY experiments/g5-postgresql-books/app/src/main/java ./src/main/java
COPY experiments/g5-postgresql-books/app/src/main/resources ./src/main/resources
COPY experiments/g5-postgresql-books/app/src/test/java ./src/test/java
COPY examples/catalog-vertical/CatalogVerticalTest.java ./src/test/java/dev/protocolia/generated/custom/CatalogVerticalTest.java
COPY examples/stock-change/protocolia/StockAdjustmentContractTest.java ./src/test/java/dev/protocolia/generated/custom/StockAdjustmentContractTest.java
COPY examples/books-paging-v03/BooksPaginationHttpTest.java ./src/test/java/dev/protocolia/generated/custom/BooksPaginationHttpTest.java
COPY experiments/openapi-generator-spring/app/src/test/java/dev/protocolia/domain/DelegateCompletenessTest.java ./src/test/java/dev/protocolia/domain/DelegateCompletenessTest.java
COPY experiments/openapi-generator-spring/app/src/test/java/dev/protocolia/domain/ErrorDispatchSecurityTest.java ./src/test/java/dev/protocolia/domain/ErrorDispatchSecurityTest.java
COPY experiments/g5-postgresql-books/restart_check.py ./restart_check.py
ENV G5_JDBC_URL="jdbc:postgresql://127.0.0.1:55432/books_test"
ENV G5_DB_USER="postgres"
ENV G5_DB_PASSWORD=""
ENV PROTOCOLIA_USER="g5-test-owner"
ENV PROTOCOLIA_PASSWORD="g5-local-only-password-20261012"
ENV PROTOCOLIA_SCOPES="catalog.read,catalog.write"
ENV PROTOCOLIA_VIEWER_USER="g5-test-viewer"
ENV PROTOCOLIA_VIEWER_PASSWORD="g5-local-viewer-password-20261012"
RUN set -eu; \
    install -d -m 0700 -o postgres -g postgres /tmp/g5-pg; \
    su postgres -c "initdb -D /tmp/g5-pg -A trust --no-instructions" >/tmp/g5-init.log; \
    su postgres -c "pg_ctl -D /tmp/g5-pg -o '-c listen_addresses=127.0.0.1 -p 55432' -l /tmp/g5-postgres.log start"; \
    trap 'su postgres -c "pg_ctl -D /tmp/g5-pg -m immediate stop" || true' EXIT; \
    su postgres -c "createdb -h 127.0.0.1 -p 55432 books_test"; \
    echo "G5_POSTGRES_VERSION $(psql --version)"; \
    mvn -B -ntp clean verify; \
    python3 restart_check.py; \
    su postgres -c "psql -h 127.0.0.1 -p 55432 -d books_test -Atc \"SELECT 'G5_DURABLE_ROW_COUNT=' || count(*) FROM books\""; \
    echo G5_POSTGRES_FLYWAY_MAVEN_RESTART_PASSED > /tmp/g5-verified.txt

# Publish ONLY a safe build-evidence marker, not a publicly writable API or
# PostgreSQL database. No actual PostgreSQL socket/volume leaves prior stage.
FROM python:3.13-alpine
WORKDIR /app
COPY --from=database-tests /tmp/g5-verified.txt ./verified.txt
COPY experiments/g5-postgresql-books/health_only.py ./health_only.py
USER 65532:65532
EXPOSE 10000
CMD ["python","-u","/app/health_only.py"]
