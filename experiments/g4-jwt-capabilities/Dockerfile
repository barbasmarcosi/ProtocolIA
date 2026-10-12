# G4 JWT capability mapping — isolated, provider-free offline security test.
# The only public endpoint of the final image is a static health marker;
# production resource-server app remains test-only until a real IdP is configured.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/books-paging-v03/contract.json ./examples/books-paging-v03/contract.json
COPY examples/books-paging-v03/resources.json ./examples/books-paging-v03/resources.json
COPY examples/books-paging-v03/http-errors.json ./examples/books-paging-v03/http-errors.json
COPY experiments/g4-jwt-capabilities/verify_capabilities.py ./verify_capabilities.py
COPY experiments/g4-jwt-capabilities/jwt_projection.py ./jwt_projection.py
COPY experiments/g4-jwt-capabilities/app/src/main/java/dev/protocolia/security/JwtCapabilitySecurity.java ./JwtCapabilitySecurity.java
COPY experiments/g4-jwt-capabilities/app/src/main/java/dev/protocolia/domain/BooksDelegate.java ./BooksDelegate.java
RUN PYTHONPATH=src python -m protocolia compile-bundle \
    examples/books-paging-v03/contract.json \
    --profile java-spring-basic-demo \
    --resources examples/books-paging-v03/resources.json \
    --domain-errors examples/books-paging-v03/http-errors.json \
    --out /contract-bundle
RUN python verify_capabilities.py /contract-bundle/capability-manifest.json \
    JwtCapabilitySecurity.java BooksDelegate.java
RUN python jwt_projection.py /contract-bundle/openapi.json \
    /contract-bundle/capability-manifest.json /contract-bundle/openapi.g4-jwt.json

FROM maven:3.9.11-eclipse-temurin-21 AS api-generator
WORKDIR /gen
COPY --from=contract /contract-bundle/openapi.g4-jwt.json ./openapi.json
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy \
    -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar \
    -DoutputDirectory=/tools
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
    -g spring -i /gen/openapi.json -o /gen/upstream \
    --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
    --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java

FROM maven:3.9.11-eclipse-temurin-21 AS test
WORKDIR /work/app
COPY experiments/g4-jwt-capabilities/app/pom.xml ./pom.xml
COPY --from=api-generator /gen/upstream/src/main/java ./src/main/java
# Only user-owned G1 business rules and application entrypoint, not G1 Basic security:
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/Application.java ./src/main/java/dev/protocolia/Application.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/domain/BookInventory.java ./src/main/java/dev/protocolia/domain/BookInventory.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/domain/HealthDelegate.java ./src/main/java/dev/protocolia/domain/HealthDelegate.java
COPY experiments/g4-jwt-capabilities/app/src/main/java ./src/main/java
COPY experiments/g4-jwt-capabilities/app/src/main/resources ./src/main/resources
COPY experiments/g4-jwt-capabilities/app/src/test/java ./src/test/java
RUN mvn -B -ntp clean verify \
    && echo 'G4_RSA_JWKS_JWT_HTTP_AND_METHOD_AUTH_PASSED'

# Independently check the same real JWT app with Schemathesis on localhost.
# No public network mutation: only GET operations, bounded examples/time.
FROM python:3.13-bookworm AS schemathesis
WORKDIR /g4
RUN python -m pip install --no-cache-dir 'schemathesis==4.30.1' 'PyJWT[crypto]==2.10.1'
COPY --from=contract /contract-bundle/openapi.g4-jwt.json ./openapi.json
COPY --from=test /work/app/target/g4-jwt-books-0.1.0.jar ./g4.jar
COPY --from=eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:${PATH}"
COPY experiments/g4-jwt-capabilities/schemathesis_runner.py ./schemathesis_runner.py
RUN python schemathesis_runner.py /g4/openapi.json /g4/g4.jar

# Deliberately does not run the JWT test server in a public deployment.
# The verified resource server requires a real trusted IdP/JWKS configuration.
FROM python:3.13-alpine
WORKDIR /app
COPY --from=test /work/app/target/surefire-reports ./reports
COPY --from=schemathesis /tmp/g4-schemathesis-passed.txt ./schemathesis-passed.txt
COPY experiments/g4-jwt-capabilities/health_only.py ./health_only.py
USER 65532:65532
EXPOSE 10000
CMD ["python","-u","/app/health_only.py"]
