# ProtocolIA P5: actual NEW requirements -> generated API + generated Orval
# -> handwritten domain/React integration -> public disposable PostgreSQL app.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY experiments/taller-requirements-v1/contract.json ./contract.json
COPY experiments/taller-requirements-v1/resources.json ./resources.json
COPY experiments/taller-requirements-v1/http-errors.json ./http-errors.json
RUN PYTHONPATH=src python -m protocolia compile-bundle contract.json \
 --profile java-spring-basic-demo --resources resources.json \
 --domain-errors http-errors.json --out /bundle
RUN PYTHONPATH=src python -m protocolia compile-bundle contract.json \
 --profile java-spring-basic-demo --resources resources.json \
 --domain-errors http-errors.json --out /bundle2 \
 && diff -rq /bundle /bundle2 \
 && echo TALLER_CANONICAL_COMPILER_DETERMINISTIC

FROM maven:3.9.11-eclipse-temurin-21 AS generator
WORKDIR /gen
COPY --from=contract /bundle/openapi.json ./openapi.json
RUN mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy \
 -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar \
 -DoutputDirectory=/tools
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
 -g spring -i openapi.json -o upstream \
 --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
 --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java
RUN java -jar /tools/openapi-generator-cli-7.26.0.jar generate \
 -g spring -i openapi.json -o upstream-again \
 --additional-properties=library=spring-boot,delegatePattern=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream \
 --global-property=apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java \
 && diff -rq upstream/src/main/java upstream-again/src/main/java \
 && echo TALLER_JAVA_CODEGEN_REPRODUCIBLE

FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY experiments/taller-requirements-v1/web ./
COPY --from=contract /bundle ./contract-bundle
RUN cp contract-bundle/openapi.json openapi.json
RUN npm ci --no-audit --no-fund
RUN npm run generate && npm run verify:contract && npm run typecheck && npm run build \
 && echo TALLER_ORVAL_RJSF_TYPESCRIPT_BUILD_SUCCESS

FROM maven:3.9.11-eclipse-temurin-21 AS java-build
WORKDIR /app
COPY experiments/taller-requirements-v1/app/pom.xml ./pom.xml
COPY --from=generator /gen/upstream/src/main/java ./src/main/java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/Application.java ./src/main/java/dev/protocolia/Application.java
COPY experiments/openapi-generator-spring/app/src/main/java/dev/protocolia/domain/HealthDelegate.java ./src/main/java/dev/protocolia/domain/HealthDelegate.java
COPY experiments/taller-requirements-v1/app/src ./src
COPY --from=web /web/dist ./src/main/resources/static
RUN mvn -B -ntp -DskipTests clean package \
 && echo TALLER_SPRING_GENERATED_DOMAIN_BUILD_SUCCESS

FROM postgres:16.10-bookworm AS smoke
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=maven:3.9.11-eclipse-temurin-21 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:/usr/lib/postgresql/16/bin:${PATH}"
WORKDIR /app
COPY --from=java-build /app/target/taller-tools-pilot-0.1.0.jar ./taller.jar
COPY experiments/taller-requirements-v1/start.sh ./start.sh
COPY experiments/taller-requirements-v1/smoke.py ./smoke.py
ENV PORT=10000
ENV PROTOCOLIA_USER=taller-test-writer
ENV PROTOCOLIA_PASSWORD=test-only-strong-password-taller
ENV PROTOCOLIA_SCOPES=inventory.read,inventory.write
ENV PROTOCOLIA_VIEWER_USER=taller-test-reader
ENV PROTOCOLIA_VIEWER_PASSWORD=test-only-strong-password-reader
ENV TALLER_JDBC_URL=jdbc:postgresql://127.0.0.1:55439/tools_demo
ENV TALLER_DB_USER=postgres
ENV TALLER_DB_PASSWORD=""
ENV TALLER_PGDATA=/tmp/taller-smoke-db
RUN (bash ./start.sh > /tmp/taller-smoke.log 2>&1 & pid=$!; \
 trap 'kill $pid 2>/dev/null || true' EXIT; \
 python3 /app/smoke.py || { cat /tmp/taller-smoke.log; exit 1; }; \
 echo TALLER_REAL_HTTP_POSTGRES_AUTH_SMOKE_PASS > /tmp/taller-verified.txt)

FROM postgres:16.10-bookworm
COPY --from=maven:3.9.11-eclipse-temurin-21 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:/usr/lib/postgresql/16/bin:${PATH}"
ENV PORT=10000
ENV TALLER_JDBC_URL=jdbc:postgresql://127.0.0.1:55439/tools_demo
ENV TALLER_DB_USER=postgres
ENV TALLER_DB_PASSWORD=""
ENV JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=2 -XX:MaxRAMPercentage=55 -XX:+UseSerialGC"
WORKDIR /app
COPY --from=smoke /tmp/taller-verified.txt ./verified.txt
COPY --from=java-build /app/target/taller-tools-pilot-0.1.0.jar ./taller.jar
COPY experiments/taller-requirements-v1/start.sh ./start.sh
EXPOSE 10000
CMD ["bash","/app/start.sh"]
