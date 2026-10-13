# G5 v0.4 disposable contract -> Java -> TS generator proof.
# No real DB, persistent API or customer data reaches the public image.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY tests/test_v04_evolution.py ./tests/test_v04_evolution.py
COPY examples/books-paging-v03 ./examples/books-paging-v03
COPY examples/books-evolution-v04 ./examples/books-evolution-v04
RUN PYTHONPATH=src python -m unittest discover -s tests -p test_v04_evolution.py -v
RUN PYTHONPATH=src python -m protocolia compile-bundle  examples/books-evolution-v04/contract.json --profile java-spring-basic-demo  --resources examples/books-evolution-v04/resources.json  --domain-errors examples/books-paging-v03/http-errors.json --out /bundle
RUN PYTHONPATH=src python -m protocolia compile-bundle  examples/books-evolution-v04/contract.json --profile java-spring-basic-demo  --resources examples/books-evolution-v04/resources.json  --domain-errors examples/books-paging-v03/http-errors.json --out /bundle-again  && diff -rq /bundle /bundle-again && echo G5_V04_BUNDLE_IDEMPOTENT
RUN PYTHONPATH=src python -m protocolia generate-java  examples/books-evolution-v04/contract.json --out /java-output

FROM maven:3.9.11-eclipse-temurin-21 AS java-generator
WORKDIR /gen
COPY --from=contract /bundle/openapi.json ./openapi.json
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy  -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar -DoutputDirectory=/tools
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate  -g spring -i openapi.json -o upstream  --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream  --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate  -g spring -i openapi.json -o upstream-again  --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream  --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java
RUN diff -rq upstream/src/main/java upstream-again/src/main/java  && echo G5_V04_UPSTREAM_JAVA_IDEMPOTENT

FROM maven:3.9.11-eclipse-temurin-21 AS java-compile
WORKDIR /app
COPY experiments/openapi-generator-spring/app/pom.xml ./pom.xml
COPY --from=java-generator /gen/upstream/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/resources ./src/main/resources
RUN mvn -B -ntp -DskipTests package && echo G5_V04_JAVA_BUILD_PASS

FROM node:22-bookworm-slim AS web-compile
WORKDIR /web
COPY examples/books-web/package.json examples/books-web/package-lock.json ./
COPY examples/books-web/orval.config.ts examples/books-web/tsconfig.json examples/books-web/vite.config.ts ./
COPY examples/books-web/index.html ./
COPY examples/books-web/scripts ./scripts
COPY examples/books-web/src ./src
COPY --from=contract /bundle ./contract-bundle
RUN cp contract-bundle/openapi.json ./openapi.json
RUN npm ci --no-audit --no-fund
RUN npm run generate && npm run verify:contract && npm run verify:regen  && npm run typecheck && npm run build && echo G5_V04_ORVAL_RJSF_BUILD_PASS

# Functional persistence and restart verification on a *real* disposable PostgreSQL.
# This stage is discarded: the final image contains no database server/volume.
FROM postgres:16.10-bookworm AS database-integration
COPY --from=maven:3.9.11-eclipse-temurin-21 /opt/java/openjdk /opt/java/openjdk
COPY --from=maven:3.9.11-eclipse-temurin-21 /usr/share/maven /usr/share/maven
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:/usr/share/maven/bin:/usr/lib/postgresql/16/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work/app
COPY experiments/g5-postgresql-books/app/pom.xml ./pom.xml
COPY --from=java-generator /gen/upstream/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/Application.java ./src/main/java/dev/protocolia/Application.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/domain/HealthDelegate.java ./src/main/java/dev/protocolia/domain/HealthDelegate.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/security/DemoSecurity.java ./src/main/java/dev/protocolia/security/DemoSecurity.java
COPY experiments/g5-contract-evolution/app/src/main/java ./src/main/java
COPY experiments/g5-postgresql-books/app/src/main/resources/application.properties ./src/main/resources/application.properties
COPY experiments/g5-postgresql-books/app/src/main/resources/db/migration/V1__create_books.sql ./src/main/resources/db/migration/V1__create_books.sql
COPY experiments/g5-contract-evolution/app/src/main/resources/db/migration ./src/main/resources/db/migration
COPY experiments/g5-contract-evolution/app/src/test/java ./src/test/java
COPY experiments/g5-postgresql-books/app/src/test/java ./src/test/java
COPY examples/books-paging-v03/BooksPaginationHttpTest.java ./src/test/java/dev/protocolia/generated/custom/BooksPaginationHttpTest.java
COPY experiments/openapi-generator-spring/app/src/test/java/dev/protocolia/domain/DelegateCompletenessTest.java ./src/test/java/dev/protocolia/domain/DelegateCompletenessTest.java
COPY experiments/openapi-generator-spring/app/src/test/java/dev/protocolia/domain/ErrorDispatchSecurityTest.java ./src/test/java/dev/protocolia/domain/ErrorDispatchSecurityTest.java
COPY experiments/g5-contract-evolution/restart_check.py ./restart_check.py
ENV G5_JDBC_URL="jdbc:postgresql://127.0.0.1:55432/books_test"
ENV G5_DB_USER="postgres"
ENV G5_DB_PASSWORD=""
ENV PROTOCOLIA_USER="g5-v04-test-owner"
ENV PROTOCOLIA_PASSWORD="g5-v04-local-only-password-20261012"
ENV PROTOCOLIA_SCOPES="catalog.read,catalog.write"
ENV PROTOCOLIA_VIEWER_USER="g5-v04-test-viewer"
ENV PROTOCOLIA_VIEWER_PASSWORD="g5-v04-local-viewer-password-20261012"
RUN set -eu; \
 install -d -m 0700 -o postgres -g postgres /tmp/g5-pg; \
 su postgres -c "initdb -D /tmp/g5-pg -A trust --no-instructions" >/tmp/g5-init.log; \
 su postgres -c "pg_ctl -D /tmp/g5-pg -o '-c listen_addresses=127.0.0.1 -p 55432' -l /tmp/g5-postgres.log start"; \
 trap 'su postgres -c "pg_ctl -D /tmp/g5-pg -m immediate stop" || true' EXIT; \
 su postgres -c "createdb -h 127.0.0.1 -p 55432 books_test"; \
 mvn -B -ntp clean verify; \
 python3 restart_check.py; \
 su postgres -c "psql -h 127.0.0.1 -p 55432 -d books_test -Atc \"SELECT 'G5_V04_DURABLE_ROWS=' || count(*) FROM books\""; \
 echo G5_V04_POSTGRES_FLYWAY_HTTP_RESTART_PASS > /tmp/g5-v04-verified.txt

FROM python:3.13-alpine
WORKDIR /app
COPY --from=database-integration /tmp/g5-v04-verified.txt ./verified.txt
COPY --from=web-compile /web/dist ./compiled-frontend
COPY experiments/g5-contract-evolution/health_only.py ./health_only.py
USER 65532:65532
EXPOSE 10000
CMD ["python","-u","health_only.py"]
