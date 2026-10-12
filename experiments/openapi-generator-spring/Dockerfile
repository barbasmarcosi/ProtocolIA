# G1: inspect exact pinned upstream-generated signatures from the G0 v0.3 OpenAPI.
# Introspection only: this first build is deliberately NOT claimed as a runnable API.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/books-paging-v03/contract.json ./examples/books-paging-v03/contract.json
COPY examples/books-paging-v03/resources.json ./examples/books-paging-v03/resources.json
COPY examples/books-paging-v03/http-errors.json ./examples/books-paging-v03/http-errors.json
RUN PYTHONPATH=src python -m protocolia compile-bundle \
    examples/books-paging-v03/contract.json \
    --profile java-spring-basic-demo \
    --resources examples/books-paging-v03/resources.json \
    --domain-errors examples/books-paging-v03/http-errors.json \
    --out /contract-bundle

FROM maven:3.9.11-eclipse-temurin-21 AS upstream-generator
WORKDIR /g1
COPY --from=contract /contract-bundle/openapi.json ./openapi.json
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy \
    -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar \
    -DoutputDirectory=/tools
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar version
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
    -g spring -i /g1/openapi.json -o /g1/upstream \
    --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useTags=true,openApiNullable=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
    --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=false
RUN echo "G1_GENERATOR_SIGNED_OUTPUT_BEGIN" \
    && find /g1/upstream/src/main/java -type f | sort \
    && grep -R -nE 'interface .*Delegate|class .*Controller|public (default )?(ResponseEntity<|BookPage|Book|Health|void)|default .*\(' /g1/upstream/src/main/java/dev/protocolia/upstream/api || true \
    && echo "G1_GENERATOR_SIGNED_OUTPUT_END"

# This probe is intentionally not an HTTP server. Final app is introduced
# only after handwritten domain delegates and real HTTP checks are ready.
FROM alpine:3.21
COPY --from=upstream-generator /g1/upstream/src/main/java /verified-codegen
RUN test -d /verified-codegen && find /verified-codegen -type f | wc -l
CMD ["sh", "-c", "echo 'G1 generation probe only; not a runnable service'; exit 1"]
