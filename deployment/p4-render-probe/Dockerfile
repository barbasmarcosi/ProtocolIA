# Evaluator-controlled Render build wrapper ONLY. The candidate workspace is immutable.
# The original candidate's Git subtree SHA is 85a1ea836de328fa7785ed81506f11713058717d.
FROM maven:3.9.11-eclipse-temurin-21 AS builder
WORKDIR /build
COPY benchmarks/p4/artifacts/codex-catalog-crud-r01-conventional/workspace/pom.xml ./pom.xml
COPY benchmarks/p4/artifacts/codex-catalog-crud-r01-conventional/workspace/src ./src
RUN java -version && mvn -version && mvn -B -ntp -Dmaven.test.skip=true clean package && sha256sum target/catalog-service-1.0.0.jar

FROM eclipse-temurin:21-jre
RUN groupadd -g 10001 probe && useradd -u 10001 -g 10001 -s /usr/sbin/nologin -M probe
WORKDIR /app
COPY --from=builder --chown=10001:10001 /build/target/catalog-service-1.0.0.jar /app/app.jar
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2"
EXPOSE 10000
ENTRYPOINT ["sh","-c","exec java -Dserver.port=${PORT:-10000} -jar /app/app.jar"]
