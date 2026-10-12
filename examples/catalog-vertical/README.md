# Catalog: one working generated Spring application

**Product integration example, not P4 benchmark evidence.** The runnable API uses
the ProtocolIA-generated DTOs, validation, security and sole ContractController.
The only handwritten Java is a typed CatalogHandlers business service implementing
the generated ContractHandlers interface. There is no shadow controller or second
Spring application.

Run from repository root using Python 3.11+, Java 21 and Maven:

```sh
sh examples/catalog-vertical/prepare.sh target/catalog-vertical
cd target/catalog-vertical
export PROTOCOLIA_USER=localdev
export PROTOCOLIA_PASSWORD='local-only-test-password-at-least-16'
export PROTOCOLIA_SCOPES=catalog.read,catalog.write
mvn -B -ntp clean verify
java -jar target/generated-service-0.3.0.jar
```

The integration test performs real HTTP requests against a random local port,
checking public health, authentication 401, POST 201, GET 200/404, duplicate
409 without overwriting data, invalid input 400, and rejection of unknown fields.

The custom service is in the Spring Boot component-scanned package
`dev.protocolia.generated.custom`. Running generation again updates *owned*
files only and retains custom code. Tampering with an owned file fails closed.
Without a registered ContractHandlers bean, business routes still fail with 501.

Security uses Basic auth strictly as a local demo, not a production identity
service. Books are held in memory; do not claim persistence across restarts.
Generated target v0.4 uses a documented convention: POST successful responses
are 201; other successful operations 200. The v0.2 contract does not model
success status explicitly.


## Regenerating a changed contract

Edit the contract and run the same `prepare.sh` command against the **existing**
output directory. Generated DTO/controller/interface files are updated, and
removed contract models remove only *previously owned, unmodified* generated
files. The `custom/CatalogHandlers.java` class is kept; add your implementation
of any newly generated `ContractHandlers` interface method to make Java compile.
If a generated file was edited or a new generated name collides with handwritten
code, regeneration stops rather than overwriting it. java-spring/0.3 output
manifests are intentionally incompatible with this 0.4 generator: generate into
a fresh destination and migrate handwritten code intentionally.

For a local **read-only test account**, define
`PROTOCOLIA_VIEWER_USER` and `PROTOCOLIA_VIEWER_PASSWORD` (at least 16 chars).
The generator derives its authorities from contract-declared non-writing GET
operations only. `mvn clean verify` with the viewer environment configured
checks GET 200 and POST 403; without optional viewer credentials, the primary
catalog account alone is used. These demo credentials are not production auth.


## Starting from a new contract instead of the worked example

The more general developer entry point is:

```sh
protocolia init-java examples/catalog-vertical/contract.json --out my-catalog
```

This creates an editable starter in
`my-catalog/src/main/java/dev/protocolia/generated/custom/StarterHandlers.java`.
Implement its typed methods, then run `mvn clean verify`. The existing
`prepare.sh` in this tutorial merely inserts the **already implemented**
`CatalogHandlers.java` and its integration tests; do not combine that service
with the generated `StarterHandlers` bean, as two implementations of
`ContractHandlers` would be ambiguous. Re-running `init-java` does
not overwrite handwritten logic or automatically implement new domain rules.
