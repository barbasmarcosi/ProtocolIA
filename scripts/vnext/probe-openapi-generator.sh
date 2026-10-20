#!/usr/bin/env bash
set -euo pipefail
fixture="${PROTOCOLIA_TEST_CONTRACT:-taller}"
appRoot="${PROTOCOLIA_APP_ROOT:-/work/dist/modular}"
projectA="/work/dist/openapi-generated-${fixture}-a"
projectB="/work/dist/openapi-generated-${fixture}-b"
contract="/work/examples/vnext/${fixture}/tsp-output/@typespec/openapi3/openapi.json"
test -s "$contract"
mvn -B -ntp org.apache.maven.plugins:maven-dependency-plugin:3.9.0:copy -Dartifact=org.openapitools:openapi-generator-cli:7.26.0:jar -DoutputDirectory=/work/dist/openapi-cli
cli=/work/dist/openapi-cli/openapi-generator-cli-7.26.0.jar
java -jar "$cli" version | grep -Fx 7.26.0
props="library=spring-boot,interfaceOnly=true,skipDefaultInterface=true,useSpringBoot4=true,useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,useTags=true,openApiNullable=false,useSwaggerUI=false,annotationLibrary=none,documentationProvider=none,hideGenerationTimestamp=true,apiPackage=dev.protocolia.generated.api,modelPackage=dev.protocolia.generated.model,basePackage=dev.protocolia.generated"
globals="apis,models,apiTests=false,modelTests=false,apiDocs=false,modelDocs=false,supportingFiles=ApiUtil.java"
java -jar "$cli" generate -g spring -i "$contract" -o $projectA --additional-properties="$props" --global-property="$globals" > /tmp/a0-openapi-generator-a.log
java -jar "$cli" generate -g spring -i "$contract" -o $projectB --additional-properties="$props" --global-property="$globals" > /tmp/a0-openapi-generator-b.log
test -d $projectA/src/main/java/dev/protocolia/generated
diff -qr $projectA/src/main/java $projectB/src/main/java
echo A0_OPENAPI_GENERATOR_7_26_DETERMINISTIC_PASS
find $projectA/src/main/java -type f | sort
test "$(find $projectA/src/main/java -name "*.java" | wc -l)" -ge 4
mkdir -p $appRoot/src/main/java/dev/protocolia/generated
cp -r $projectA/src/main/java/dev/protocolia/generated/. $appRoot/src/main/java/dev/protocolia/generated/
echo A0_UPSTREAM_OPENAPI_SPRING_INTERFACES_AND_MODELS_COPIED
