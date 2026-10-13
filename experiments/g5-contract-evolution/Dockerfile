# G5 v0.4 disposable contract -> Java -> TS generator proof.
# No real DB, persistent API or customer data reaches the public image.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY tests/test_v04_evolution.py ./tests/test_v04_evolution.py
COPY tests/test_fullstack_regeneration.py ./tests/test_fullstack_regeneration.py
COPY tests/test_v04_second_resource.py ./tests/test_v04_second_resource.py
COPY examples/books-paging-v03 ./examples/books-paging-v03
COPY examples/books-evolution-v04 ./examples/books-evolution-v04
COPY examples/g5-second-resource ./examples/g5-second-resource
RUN PYTHONPATH=src python -m unittest discover -s tests -p test_fullstack_regeneration.py -v
RUN PYTHONPATH=src python -m unittest discover -s tests -p test_v04_evolution.py -v
RUN PYTHONPATH=src python -m unittest discover -s tests -p test_v04_second_resource.py -v
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
COPY examples/books-web-v04/package.json examples/books-web-v04/package-lock.json ./
COPY examples/books-web-v04/orval.config.ts examples/books-web-v04/tsconfig.json examples/books-web-v04/vite.config.ts ./
COPY examples/books-web-v04/index.html ./
COPY examples/books-web-v04/scripts ./scripts
COPY examples/books-web-v04/src ./src
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

# Browser-backed G5 proof: real generated React form over HTTP to a real
# PostgreSQL-backed Java server. Database exists only during Docker build.
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS browser-integration
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-16 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /web
COPY --from=web-compile /web ./
COPY --from=maven:3.9.11-eclipse-temurin-21 /opt/java/openjdk /opt/java/openjdk
COPY --from=database-integration /work/app/target/g5-pg-books-0.1.0.jar /tmp/books.jar
COPY examples/books-web-v04/tests ./tests
COPY experiments/g5-contract-evolution/playwright.config.ts ./playwright.config.ts
COPY experiments/g3-books-ui/run-browser-tests.sh ./run-g3-browser-tests.sh
COPY experiments/g5-contract-evolution/run-browser-tests.sh ./run-browser-tests.sh
RUN bash ./run-browser-tests.sh && echo G5_BROWSER_E2E_VERIFIED >/tmp/g5-v04-browser-verified.txt

# Real command-line orchestration: same contract into disposable bundled,
# pinned Java and Orval outputs. Repeated generation must be byte-identical.
FROM node:22-bookworm-slim AS regenerate-integrated
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=maven:3.9.11-eclipse-temurin-21 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:${PATH}"
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/books-evolution-v04 ./examples/books-evolution-v04
COPY examples/books-paging-v03/http-errors.json ./examples/books-paging-v03/http-errors.json
COPY examples/books-web-v04 ./examples/books-web-v04
COPY --from=java-generator /tools/openapi-generator-cli-7.26.0.jar /tools/openapi-generator-cli-7.26.0.jar
RUN PYTHONPATH=src python3 -m protocolia regenerate-fullstack \
 examples/books-evolution-v04/contract.json --profile java-spring-basic-demo \
 --resources examples/books-evolution-v04/resources.json \
 --domain-errors examples/books-paging-v03/http-errors.json \
 --java-generator-jar /tools/openapi-generator-cli-7.26.0.jar \
 --web-template examples/books-web-v04 --out /managed \
 && PYTHONPATH=src python3 -m protocolia regenerate-fullstack \
 examples/books-evolution-v04/contract.json --profile java-spring-basic-demo \
 --resources examples/books-evolution-v04/resources.json \
 --domain-errors examples/books-paging-v03/http-errors.json \
 --java-generator-jar /tools/openapi-generator-cli-7.26.0.jar \
 --web-template examples/books-web-v04 --out /managed \
 && echo G5_REAL_FULLSTACK_REGEN_IDEMPOTENT > /tmp/g5-regen-verified.txt

# Guard legacy P0/P1/P2/P3/P4 compiler/authorization/benchmark harness
# regressions without consuming GitHub Actions or any paid providers.
FROM python:3.13-slim AS python-regressions
RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
RUN python -m pip install --no-cache-dir -e '.[operator-auth]' 'jsonschema==4.25.1' \
 && PYTHONPATH=src python -m unittest discover -s tests -v \
 && echo G5_ALL_PYTHON_REGRESSIONS_PASS > /tmp/g5-python-verified.txt

# Derive an honest bearer-only OpenAPI profile from the SAME v0.4 IR.
FROM contract AS jwt-contract
COPY experiments/g5-contract-evolution/jwt/jwt_projection.py /jwt_projection.py
RUN python /jwt_projection.py /bundle/openapi.json \
 /bundle/capability-manifest.json /bundle/openapi.g4-jwt.json

FROM java-generator AS jwt-generator
WORKDIR /jwt-gen
COPY --from=jwt-contract /bundle/openapi.g4-jwt.json ./openapi.json
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
 -g spring -i /jwt-gen/openapi.json -o /jwt-gen/upstream \
 --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
 --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java

# Same real PostgreSQL/Flyway migration; independent signed RSA/JWKS/
# issuer/audience/expiry/scope security profile. No Basic fallback.
FROM database-integration AS jwt-postgres-integration
# Do not reuse the preceding disposable DB port/socket across overlay layers.
ENV G5_JDBC_URL="jdbc:postgresql://127.0.0.1:55433/books_test"
WORKDIR /work/app
RUN rm -f src/main/java/dev/protocolia/security/DemoSecurity.java \
 src/main/java/dev/protocolia/domain/BooksDelegate.java \
 && rm -rf src/main/java/dev/protocolia/upstream src/test/java target
COPY --from=jwt-generator /jwt-gen/upstream/src/main/java ./src/main/java
COPY experiments/g5-contract-evolution/jwt/JwtCapabilitySecurity.java ./src/main/java/dev/protocolia/security/JwtCapabilitySecurity.java
COPY experiments/g5-contract-evolution/jwt/BooksDelegate.java ./src/main/java/dev/protocolia/domain/BooksDelegate.java
COPY experiments/g5-contract-evolution/jwt/pom.xml ./pom.xml
COPY experiments/g5-contract-evolution/jwt/application.properties ./src/main/resources/application.properties
COPY experiments/g5-contract-evolution/jwt/JwtAuthorizationHttpTest.java ./src/test/java/dev/protocolia/security/JwtAuthorizationHttpTest.java
RUN set -eu; \
 install -d -m 0700 -o postgres -g postgres /tmp/g5-jwt-pg; \
 su postgres -c "initdb -D /tmp/g5-jwt-pg -A trust --no-instructions" >/tmp/g5-jwt-init.log; \
 su postgres -c "pg_ctl -D /tmp/g5-jwt-pg -o '-c listen_addresses=127.0.0.1 -p 55433' -l /tmp/g5-jwt-postgres.log start" || { cat /tmp/g5-jwt-postgres.log; exit 1; }; \
 trap 'su postgres -c "pg_ctl -D /tmp/g5-jwt-pg -m immediate stop" || true' EXIT; \
 su postgres -c "createdb -h 127.0.0.1 -p 55433 books_test"; \
 mvn -B -ntp clean verify; \
 echo G5_SIGNED_JWT_POSTGRESQL_V04_PASS > /tmp/g5-jwt-verified.txt

# Second independent resource proves that codegen is not hardwired to
# Books identities, operation names, models, or Orval file names.
FROM regenerate-integrated AS second-resource-generate
WORKDIR /repo
COPY examples/g5-second-resource ./examples/g5-second-resource
COPY examples/widgets-web ./examples/widgets-web
RUN PYTHONPATH=src python3 -m protocolia regenerate-fullstack \
 examples/g5-second-resource/contract.json --profile java-spring-basic-demo \
 --resources examples/g5-second-resource/resources.json \
 --domain-errors examples/g5-second-resource/http-errors.json \
 --java-generator-jar /tools/openapi-generator-cli-7.26.0.jar \
 --web-template examples/widgets-web --out /managed-widgets \
 && echo G5_SECOND_RESOURCE_JAVA_ORVAL_REGEN_PASS > /tmp/g5-widgets-verified.txt

# Explicit backward-compatibility proof: historical G3 v0.3 React app
# is not modified or broken by v0.4 action/schema generation.
FROM contract AS legacy-contract
RUN PYTHONPATH=src python -m protocolia compile-bundle \
 examples/books-paging-v03/contract.json --profile java-spring-basic-demo \
 --resources examples/books-paging-v03/resources.json \
 --domain-errors examples/books-paging-v03/http-errors.json --out /legacy-bundle

FROM node:22-bookworm-slim AS legacy-web-v03
WORKDIR /legacy
COPY examples/books-web ./
COPY --from=legacy-contract /legacy-bundle ./contract-bundle
RUN cp contract-bundle/openapi.json ./openapi.json
RUN npm ci --no-audit --no-fund \
 && npm run generate && npm run verify:contract \
 && npm run typecheck && npm run build \
 && echo G5_HISTORICAL_V03_WEB_UNCHANGED_PASS > /tmp/g5-v03-verified.txt

FROM python:3.13-alpine
WORKDIR /app
COPY --from=database-integration /tmp/g5-v04-verified.txt ./verified.txt
COPY --from=browser-integration /tmp/g5-v04-browser-verified.txt ./browser-verified.txt
COPY --from=regenerate-integrated /tmp/g5-regen-verified.txt ./regen-verified.txt
COPY --from=python-regressions /tmp/g5-python-verified.txt ./python-verified.txt
COPY --from=jwt-postgres-integration /tmp/g5-jwt-verified.txt ./jwt-verified.txt
COPY --from=second-resource-generate /tmp/g5-widgets-verified.txt ./widgets-verified.txt
COPY --from=legacy-web-v03 /tmp/g5-v03-verified.txt ./legacy-v03-verified.txt
COPY --from=web-compile /web/dist ./compiled-frontend
COPY experiments/g5-contract-evolution/health_only.py ./health_only.py
USER 65532:65532
EXPOSE 10000
CMD ["python","-u","health_only.py"]
