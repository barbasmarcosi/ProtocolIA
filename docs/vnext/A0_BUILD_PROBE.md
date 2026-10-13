# Local JHipster A0 toolchain build probe

This is an isolated infrastructure probe, not the generated final application.

From a clean repository checkout:

```sh
docker build --progress=plain -f Dockerfile.a0-jhipster -t protocolia-a0-jhipster .
```

The image uses Node 24, Java 21, TypeSpec 1.17.0 and a pinned JHipster 9.4.0
installation. It runs contract compilation and negative checks, generates JDL
from the TypeSpec IR, invokes JHipster in an isolated scratch directory and
attempts a Maven package build. Its HTTP CMD is only a build marker: it does
**not** expose the generated Taller API, PostgreSQL or React UI.

Build success demonstrates Java compilation, not end-to-end contract fidelity.
Public identity, response schemas, capabilities and atomic writes still require
a generic adapter and PostgreSQL/HTTP/browser conformance tests.
