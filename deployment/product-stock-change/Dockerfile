# Real two-path engineering change, not a P4 study.
# Both Maven builds execute authored tests. No paid services.
FROM python:3.13-slim AS generator
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/stock-change/protocolia ./examples/stock-change/protocolia
COPY examples/stock-change/prepare.sh ./examples/stock-change/prepare.sh
COPY examples/catalog-vertical/CatalogVerticalTest.java ./examples/catalog-vertical/CatalogVerticalTest.java
COPY examples/catalog-vertical/contract.json ./examples/catalog-vertical/contract.json
COPY examples/sales-v0.2.json ./examples/sales-v0.2.json
COPY examples/inventory-v0.2.json ./examples/inventory-v0.2.json
COPY tests/test_java_spring.py ./tests/test_java_spring.py
COPY tests/test_java_project.py ./tests/test_java_project.py
COPY tests/test_java_http_profile.py ./tests/test_java_http_profile.py
COPY tests/test_resource_bundle.py ./tests/test_resource_bundle.py
COPY tests/test_inventory_backend.py ./tests/test_inventory_backend.py
RUN PYTHONPATH=src python -m unittest discover -s tests -p 'test_java*.py' -v
RUN PYTHONPATH=src python -m unittest discover -s tests -p 'test_resource_bundle.py' -v
RUN PYTHONPATH=src python -m unittest discover -s tests -p 'test_inventory_backend.py' -v
RUN sh examples/stock-change/prepare.sh /app-generated

# Independent OpenAPI 3.1 lint. A failed Spectral gate prevents the Java build.
# Pin the upstream linter rather than using npx @latest.
FROM node:22-alpine AS spectral-check
WORKDIR /spec
COPY --from=generator /app-generated/contract-bundle/openapi.json ./openapi.json
COPY deployment/g0-spectral.yaml ./.spectral.yaml
RUN npm install -g --no-audit --no-fund @stoplight/spectral-cli@6.17.0 \
    && spectral lint --ruleset .spectral.yaml --fail-severity error ./openapi.json

# Verify OpenAPI 3.1 with a second independent implementation, and prove
# a deliberately removed endpoint is classified as a breaking change.
# oasdiff v1.11.7 declares Go >=1.24 in its tagged go.mod.
FROM golang:1.25-alpine AS oasdiff-check
RUN CGO_ENABLED=0 go install github.com/oasdiff/oasdiff@v1.11.7
WORKDIR /spec
COPY --from=generator /app-generated/contract-bundle/openapi.json ./openapi.json
COPY deployment/g0-oasdiff-base.json ./base.json
COPY deployment/g0-oasdiff-removed.json ./removed.json
# In v1.11.7 the CLI has no 'validate' subcommand (Spectral owns syntax).
RUN /go/bin/oasdiff breaking ./openapi.json ./openapi.json
RUN set +e; /go/bin/oasdiff breaking ./base.json ./removed.json > /tmp/oasdiff-breaking.txt 2>&1; \
    result=$?; cat /tmp/oasdiff-breaking.txt; test "$result" -eq 1

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /work
COPY --from=generator /app-generated ./generated
COPY --from=spectral-check /spec/openapi.json ./verified-contract-openapi.json
COPY --from=oasdiff-check /spec/openapi.json ./oasdiff-checked-openapi.json
COPY examples/stock-change/direct ./direct

RUN cd /work/generated && \
    PROTOCOLIA_USER=integration-only \
    PROTOCOLIA_PASSWORD=integration-only-test-password-2026 \
    PROTOCOLIA_SCOPES=catalog.read,catalog.write \
    PROTOCOLIA_VIEWER_USER=catalog-viewer \
    PROTOCOLIA_VIEWER_PASSWORD=integration-viewer-password-2026 \
    mvn -B -ntp clean verify && \
    sha256sum target/generated-service-0.3.0.jar

RUN cd /work/direct && \
    PROTOCOLIA_USER=integration-only \
    PROTOCOLIA_PASSWORD=integration-only-test-password-2026 \
    PROTOCOLIA_SCOPES=catalog.read,catalog.write \
    PROTOCOLIA_VIEWER_USER=catalog-viewer \
    PROTOCOLIA_VIEWER_PASSWORD=integration-viewer-password-2026 \
    mvn -B -ntp clean verify && \
    sha256sum target/catalog-crud-direct-1.0.0.jar

FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -s /usr/sbin/nologin -M app
WORKDIR /app
COPY --from=build --chown=10001:10001 /work/generated/target/generated-service-0.3.0.jar /app/app.jar
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2"
EXPOSE 10000
ENTRYPOINT ["sh","-c","exec java -Dserver.port=$PORT -jar /app/app.jar"]
