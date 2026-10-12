# G2: run Orval and Kubb on identical canonical v0.3 OpenAPI.
# Real browser-capable query runtime is tested against an isolated LOCAL G1
# Spring Boot instance; absolutely no remote public service is mutated.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/books-paging-v03/contract.json ./examples/books-paging-v03/contract.json
COPY examples/books-paging-v03/resources.json ./examples/books-paging-v03/resources.json
COPY examples/books-paging-v03/http-errors.json ./examples/books-paging-v03/http-errors.json
RUN PYTHONPATH=src python -m protocolia compile-bundle \
 examples/books-paging-v03/contract.json --profile java-spring-basic-demo \
 --resources examples/books-paging-v03/resources.json \
 --domain-errors examples/books-paging-v03/http-errors.json \
 --out /contract-bundle

FROM node:22-bookworm-slim AS comparison
WORKDIR /g2
COPY experiments/g2-client-spike/package.json ./
COPY experiments/g2-client-spike/orval.config.ts ./
COPY experiments/g2-client-spike/kubb.config.ts ./
COPY experiments/g2-client-spike/tsconfig.json ./
COPY experiments/g2-client-spike/src ./src
COPY experiments/g2-client-spike/tests ./tests
COPY --from=contract /contract-bundle/openapi.json ./openapi.json
RUN npm install --no-audit --no-fund
RUN npm ls --depth=0
RUN npm run generate:orval && npm run generate:kubb
RUN npm run typecheck
RUN echo 'G2_CANDIDATE_TYPESCRIPT_PASS' \
    && test -f src/generated/orval/books.ts \
    && test -f src/generated/kubb/hooks/useListBooks.ts

# The supported Books web client uses ONE generator: Orval only.
# Kubb is confined to the independently typechecked comparison stage.
FROM node:22-bookworm-slim AS client
WORKDIR /g2
COPY examples/books-web/package.json ./
COPY examples/books-web/orval.config.ts ./
COPY examples/books-web/tsconfig.json ./
COPY examples/books-web/src ./src
COPY examples/books-web/tests ./tests
COPY examples/books-web/scripts ./scripts
COPY --from=contract /contract-bundle ./contract-bundle
COPY --from=comparison /g2/src/generated/kubb/hooks/useListBooks.ts /tmp/kubb-probe/useListBooks.ts
RUN cp contract-bundle/openapi.json ./openapi.json
RUN npm install --no-audit --no-fund
# One-time release-candidate extraction: reconstruct the exact npm lock via
# base64 chunks in Render build logs, commit the result, then switch to npm ci.
RUN node -e 'const fs=require("node:fs");const s=fs.readFileSync("package-lock.json").toString("base64");for(let i=0;i<s.length;i+=4096)console.log("G2LOCK:"+String(i/4096).padStart(4,"0")+":"+s.slice(i,i+4096));console.log("G2LOCK_END:"+s.length);'
RUN npm run generate && npm run typecheck \
  && npm run verify:contract && npm run verify:regen
RUN echo 'G2_SELECTED_ORVAL_ONLY_VERIFIED' \
  && test -f src/generated/orval/books.ts \
  && test ! -d src/generated/kubb

# Run exactly the same G1 Java backend from the source and OpenAPI used in G1.
# Regeneration is disposable and never writes to user-owned code directories.
FROM maven:3.9.11-eclipse-temurin-21 AS backend-generator
WORKDIR /g1
COPY --from=contract /contract-bundle/openapi.json ./openapi.json
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy \
    -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar -DoutputDirectory=/tools
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
    -g spring -i /g1/openapi.json -o /g1/upstream \
    --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
    --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java

FROM maven:3.9.11-eclipse-temurin-21 AS backend-build
WORKDIR /work/app
COPY experiments/openapi-generator-spring/app/pom.xml ./pom.xml
COPY --from=backend-generator /g1/upstream/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/resources ./src/main/resources
RUN mvn -B -ntp -DskipTests package \
    && test -f target/upstream-books-0.1.0.jar

FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5 AS java-runtime

FROM client AS integration
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=backend-build /work/app/target/upstream-books-0.1.0.jar /tmp/books.jar
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:${PATH}"
RUN set -eu; \
  PROTOCOLIA_USER=integration-only \
  PROTOCOLIA_PASSWORD=integration-only-test-password-2026 \
  PROTOCOLIA_SCOPES=catalog.read,catalog.write \
  PROTOCOLIA_VIEWER_USER=catalog-viewer \
  PROTOCOLIA_VIEWER_PASSWORD=integration-viewer-password-2026 \
  java -Dserver.port=10111 -jar /tmp/books.jar > /tmp/g1-test-server.log 2>&1 & \
  pid=$!; \
  trap 'kill "$pid" 2>/dev/null || true' EXIT; \
  healthy=0; \
  for i in $(seq 1 100); do \
    if node -e "fetch('http://127.0.0.1:10111/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then healthy=1; break; fi; \
    sleep 1; \
  done; \
  if [ "$healthy" -ne 1 ]; then cat /tmp/g1-test-server.log; exit 1; fi; \
  G2_API_BASE_URL=http://127.0.0.1:10111 npm run test:real || { cat /tmp/g1-test-server.log; exit 1; }; \
  echo 'G2_REAL_HTTP_TEST_VERIFIED' > /g2/verified.txt

# The public service is merely the demo backend. Verification happened
# against its own isolated loopback process in the integration build stage.
FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -s /usr/sbin/nologin -M app
WORKDIR /app
COPY --from=integration /g2/verified.txt /app/verified.txt
COPY --from=backend-build --chown=10001:10001 /work/app/target/upstream-books-0.1.0.jar /app/app.jar
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2"
EXPOSE 10000
ENTRYPOINT ["sh","-c","exec java -Dserver.port=$PORT -jar /app/app.jar"]
