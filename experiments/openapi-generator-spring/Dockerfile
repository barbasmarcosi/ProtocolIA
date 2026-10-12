# G1 pinned OpenAPI Generator proof against the exact G0 Books v0.3 contract.
# Only the generator's API/DTO/controller/delegate files are disposable.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/books-paging-v03/contract.json ./examples/books-paging-v03/contract.json
COPY examples/books-paging-v03/resources.json ./examples/books-paging-v03/resources.json
COPY examples/books-paging-v03/http-errors.json ./examples/books-paging-v03/http-errors.json
COPY experiments/openapi-generator-spring/verify_capabilities.py ./verify_capabilities.py
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/security/DemoSecurity.java ./DemoSecurity.java
RUN PYTHONPATH=src python -m protocolia compile-bundle \
    examples/books-paging-v03/contract.json \
    --profile java-spring-basic-demo \
    --resources examples/books-paging-v03/resources.json \
    --domain-errors examples/books-paging-v03/http-errors.json \
    --out /contract-bundle
RUN python verify_capabilities.py /contract-bundle/capability-manifest.json DemoSecurity.java

FROM maven:3.9.11-eclipse-temurin-21 AS upstream-generator
WORKDIR /g1
COPY --from=contract /contract-bundle/openapi.json ./openapi.json
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy \
    -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar \
    -DoutputDirectory=/tools
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar version
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
    -g spring -i /g1/openapi.json -o /g1/upstream \
    --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
    --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=false
RUN echo "G1_GENERATED_API_AND_MODELS" && find /g1/upstream/src/main/java -type f | sort \
    && test -f /g1/upstream/src/main/java/dev/protocolia/upstream/api/BooksApiDelegate.java \
    && test -f /g1/upstream/src/main/java/dev/protocolia/upstream/api/DefaultApiDelegate.java \
    && test -f /g1/upstream/src/main/java/dev/protocolia/upstream/model/BookPage.java
# Regenerate the source into a *different directory* and verify deterministic
# output. Never write into the user-owned application tree.
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
    -g spring -i /g1/openapi.json -o /g1/regenerated \
    --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
    --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=false
RUN diff -rq /g1/upstream/src/main/java /g1/regenerated/src/main/java \
    && echo "G1_GENERATED_JAVA_IDEMPOTENT"

FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /work/app
COPY experiments/openapi-generator-spring/app/pom.xml ./pom.xml
COPY --from=upstream-generator /g1/upstream/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/resources ./src/main/resources
COPY experiments/openapi-generator-spring/app/src/test/java ./src/test/java
COPY examples/catalog-vertical/CatalogVerticalTest.java ./src/test/java/dev/protocolia/generated/custom/CatalogVerticalTest.java
COPY examples/stock-change/protocolia/StockAdjustmentContractTest.java ./src/test/java/dev/protocolia/generated/custom/StockAdjustmentContractTest.java
COPY examples/books-paging-v03/BooksPaginationHttpTest.java ./src/test/java/dev/protocolia/generated/custom/BooksPaginationHttpTest.java
RUN PROTOCOLIA_USER=integration-only \
    PROTOCOLIA_PASSWORD=integration-only-test-password-2026 \
    PROTOCOLIA_SCOPES=catalog.read,catalog.write \
    PROTOCOLIA_VIEWER_USER=catalog-viewer \
    PROTOCOLIA_VIEWER_PASSWORD=integration-viewer-password-2026 \
    mvn -B -ntp clean verify && \
    sha256sum target/upstream-books-0.1.0.jar

FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -s /usr/sbin/nologin -M app
WORKDIR /app
COPY --from=build --chown=10001:10001 /work/app/target/upstream-books-0.1.0.jar /app/app.jar
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2"
EXPOSE 10000
ENTRYPOINT ["sh","-c","exec java -Dserver.port=$PORT -jar /app/app.jar"]
