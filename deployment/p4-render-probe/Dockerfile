# Infrastructure smoke ONLY. Not an agent candidate.
FROM maven:3.9.11-eclipse-temurin-21 AS builder
WORKDIR /build
COPY deployment/p4-render-probe/pom.xml ./pom.xml
COPY deployment/p4-render-probe/src ./src
RUN java -version && mvn -version && mvn -B -ntp -DskipTests package && sha256sum target/p4-render-probe-0.0.1.jar
FROM eclipse-temurin:21-jre
RUN groupadd -g 10001 probe && useradd -u 10001 -g 10001 -s /usr/sbin/nologin -M probe
WORKDIR /app
COPY --from=builder --chown=10001:10001 /build/target/p4-render-probe-0.0.1.jar /app/app.jar
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:ActiveProcessorCount=2"
EXPOSE 10000
ENTRYPOINT ["sh","-c","exec java -Dserver.port=${PORT:-10000} -jar /app/app.jar"]
