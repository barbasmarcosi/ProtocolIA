# Product integration: contract -> ProtocolIA generation -> one custom bean -> Maven+HTTP tests.
FROM python:3.13-slim AS generate
WORKDIR /source
COPY src/protocolia ./src/protocolia
COPY examples/catalog-vertical ./examples/catalog-vertical
COPY examples/sales-v0.2.json ./examples/sales-v0.2.json
COPY tests/test_java_spring.py ./tests/test_java_spring.py
RUN PYTHONPATH=src python -m unittest discover -s tests -p test_java_spring.py -v
RUN sh examples/catalog-vertical/prepare.sh /out

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS build
WORKDIR /app
COPY --from=generate /out/ ./
RUN PROTOCOLIA_USER=integration-only \
    PROTOCOLIA_PASSWORD=integration-only-test-password-2026 \
    PROTOCOLIA_SCOPES=catalog.read,catalog.write \
    mvn -B -ntp clean verify && sha256sum target/generated-service-0.3.0.jar

FROM eclipse-temurin:21-jre@sha256:cff19e6215689161eb6162c11b86b0c60ddf802164f2eaf48d570f8fb79a36c5
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -s /usr/sbin/nologin -M app
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/target/generated-service-0.3.0.jar /app/app.jar
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2"
EXPOSE 10000
ENTRYPOINT ["sh","-c","exec java -Dserver.port=$PORT -jar /app/app.jar"]
