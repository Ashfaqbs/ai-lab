# syntax=docker/dockerfile:1

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:17-jre-alpine
RUN apk add --no-cache curl \
    && addgroup -S appgroup \
    && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=build /build/target/demo-api-0.1.0.jar app.jar
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
