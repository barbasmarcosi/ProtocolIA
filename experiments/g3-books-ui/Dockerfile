# G3 real React / RJSF / Playwright vertical.
# Source of truth is the same G0 v0.3 contract as G1 and G2.
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

FROM node:22-bookworm-slim AS frontend
WORKDIR /g3
COPY examples/books-web/package.json ./
COPY examples/books-web/package-lock.json ./
COPY examples/books-web/orval.config.ts ./
COPY examples/books-web/tsconfig.json ./
COPY examples/books-web/vite.config.ts ./
COPY examples/books-web/playwright.config.ts ./
COPY examples/books-web/index.html ./
COPY examples/books-web/scripts ./scripts
COPY examples/books-web/src ./src
COPY examples/books-web/tests ./tests
COPY --from=contract /contract-bundle ./contract-bundle
RUN cp contract-bundle/openapi.json ./openapi.json
# Lock file generated from actual resolved npm dependencies, committed to the repo.
COPY examples/books-web/package-lock.json ./package-lock.json
RUN npm ci --no-audit --no-fund
RUN npm run generate && npm run verify:contract && npm run verify:regen \
 && npm run typecheck && npm run build
RUN echo 'G3_RJSF_TYPESCRIPT_AND_BUILD_PASS'

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

# Chromium has to run a *real web UI*, not static HTML render/mocked HTTP.
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS browser-e2e
WORKDIR /g3
COPY --from=frontend /g3 ./
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=backend-build /work/app/target/upstream-books-0.1.0.jar /tmp/books.jar
COPY experiments/g3-books-ui/run-browser-tests.sh ./run-browser-tests.sh
RUN bash ./run-browser-tests.sh && echo 'G3_BROWSER_VERIFIED' > /g3/verified.txt

# The live demo serves Vite preview through the same origin as its Java API;
# browser input is never stored and no credentials are compiled into the UI.
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=frontend /g3/node_modules ./node_modules
COPY --from=frontend /g3/dist ./dist
COPY --from=frontend /g3/vite.config.ts ./vite.config.ts
COPY --from=frontend /g3/package.json ./package.json
COPY --from=browser-e2e /g3/verified.txt ./verified.txt
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=backend-build /work/app/target/upstream-books-0.1.0.jar ./backend.jar
COPY experiments/g3-books-ui/start-demo.mjs ./start-demo.mjs
USER node
EXPOSE 10000
CMD ["node","start-demo.mjs"]
