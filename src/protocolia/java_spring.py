"""Provider-free Java 21 / Spring Boot 4 source generator (strict bounded subset)."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any
from .core import ContractError, _fail, _json, validate

PKG = "dev.protocolia.generated"
SRC = "src/main/java/dev/protocolia/generated/"
BAD = set(("class record interface enum package import public private protected static "
           "void return new String Object Integer Long Boolean Double List UUID "
           "assert int long float double byte short char boolean null var sealed").split())
TYPES = {"string":"String","integer":"Integer","number":"java.math.BigDecimal",
         "boolean":"Boolean","uuid":"java.util.UUID","datetime":"java.time.OffsetDateTime"}

def jt(name: str) -> str:
    arr=name.endswith("[]")
    base=name[:-2] if arr else name
    if base not in TYPES and base in BAD:
        _fail("unsupported Java type: "+base)
    result=TYPES.get(base,base)
    return "java.util.List<"+result+">" if arr else result

def annotation(spec: dict) -> str:
    base=spec["type"].removesuffix("[]")
    constraints=spec.get("constraints",{})
    if "enum" in constraints:
        _fail("java-spring: enum validation translation not implemented")
    anns=[]
    if spec["required"]:
        anns.append("@jakarta.validation.constraints.NotNull")
    if base not in TYPES:
        anns.append("@jakarta.validation.Valid")
    if base == "string":
        arguments=["min="+str(constraints.get("minLength",0)), "max="+str(constraints.get("maxLength",4096))]
        arguments=[x.replace("minLength","min").replace("maxLength","max") for x in arguments]
        anns.append("@jakarta.validation.constraints.Size("+", ".join(arguments)+")")
    if "pattern" in constraints:
        anns.append("@jakarta.validation.constraints.Pattern(regexp="+json.dumps(constraints["pattern"])+")")
    for key,kind in (("minimum","DecimalMin"),("maximum","DecimalMax")):
        if key in constraints:
            anns.append("@jakarta.validation.constraints."+kind+"("+json.dumps(str(constraints[key]))+")")
    return " ".join(anns)

def record(name: str,fields: dict) -> str:
    if name in BAD: _fail("unsupported Java model name: "+name)
    parts=[]
    for field, spec in fields.items():
        if field in BAD: _fail("unsupported Java field name: "+field)
        if not spec["required"]: _fail("java-spring: optional/null semantics not yet supported for "+name+"."+field)
        parts.append("    "+annotation(spec)+" "+jt(spec["type"])+" "+field)
    return "package "+PKG+";\npublic record "+name+"(\n"+",\n".join(parts)+"\n) {}\n"

def handler_interface(ops: dict) -> str:
    """Typed boundary for human-written business rules; generator owns the HTTP surface."""
    methods = []
    for name, op in ops.items():
        params = [jt(typ) + " " + key for key, typ in op["params"].items()]
        for key, field in op.get("query", {}).items():
            params.append(jt(field["type"]) + " " + key)
        if "request" in op:
            params.append(op["request"] + " body")
        methods.append("    " + op["response"] + " " + name + "(" + ", ".join(params) + ");")
    return ("package " + PKG + ";\npublic interface ContractHandlers {\n" +
            "\n".join(methods) + "\n}\n")


def controller(ops: dict) -> str:
    endpoints = []
    for name, op in ops.items():
        if name in BAD:
            _fail("unsupported Java operation name: " + name)
        params = []
        args = []
        for key, typ in op["params"].items():
            if key in BAD:
                _fail("unsupported Java parameter name: " + key)
            params.append('@org.springframework.web.bind.annotation.PathVariable("' + key + '") ' + jt(typ) + ' ' + key)
            args.append(key)
        for key, field in op.get("query", {}).items():
            if key in BAD:
                _fail("unsupported Java query name: " + key)
            low = field["constraints"]["minimum"]
            high = field["constraints"]["maximum"]
            default = field["default"]
            params.append(
                '@org.springframework.web.bind.annotation.RequestParam(name="' + key +
                '",required=false,defaultValue="' + str(default) + '") ' +
                '@jakarta.validation.constraints.Min(' + str(low) + ') ' +
                '@jakarta.validation.constraints.Max(' + str(high) + ') ' +
                jt(field["type"]) + ' ' + key
            )
            args.append(key)
        if "request" in op:
            params.append("@jakarta.validation.Valid @org.springframework.web.bind.annotation.RequestBody " + op["request"] + " body")
            args.append("body")
        auth = ('@org.springframework.security.access.prepost.PreAuthorize("hasAuthority(' +
                "'" + op["capability"] + "'" + ')")\n    ') if op["capability"] != "public" else ""
        # Java target v0.4 convention: POST returns 201; other methods 200.
        response = ('@org.springframework.web.bind.annotation.ResponseStatus(org.springframework.http.HttpStatus.CREATED)\n    '
                    if op["method"] == "POST" else "")
        endpoints.append(
            '    ' + auth + response +
            '@org.springframework.web.bind.annotation.RequestMapping(path="' + op["path"] +
            '",method=org.springframework.web.bind.annotation.RequestMethod.' + op["method"] + ')\n' +
            '    public ' + op["response"] + ' ' + name + '(' + ", ".join(params) + ') {\n' +
            '        ContractHandlers handler = handlers.getIfAvailable();\n' +
            '        if (handler == null) throw new org.springframework.web.server.ResponseStatusException(' +
            'org.springframework.http.HttpStatus.NOT_IMPLEMENTED, "business handler missing");\n' +
            '        return handler.' + name + '(' + ", ".join(args) + ');\n' +
            '    }')
    return (
        "package " + PKG + ";\n" +
        "@org.springframework.web.bind.annotation.RestController\n" +
        ("@org.springframework.validation.annotation.Validated\n" if any(
            o.get("query") for o in ops.values()) else "") +
        "public class ContractController {\n" +
        "    private final org.springframework.beans.factory.ObjectProvider<ContractHandlers> handlers;\n" +
        "    public ContractController(org.springframework.beans.factory.ObjectProvider<ContractHandlers> handlers) {\n" +
        "        this.handlers = handlers;\n" +
        "    }\n\n" +
        "\n\n".join(endpoints) + "\n}\n"
    )

def security(ops: dict) -> str:
    permits="\n".join('            a.requestMatchers(org.springframework.http.HttpMethod.'+o["method"]+', "'+o["path"]+'").permitAll();'
                      for o in ops.values() if o["capability"]=="public")
    # Optional demonstration viewer inherits *only* the declared read-only GET
    # capabilities. Never generate permissions for write operations.
    reader_capabilities = sorted({o["capability"] for o in ops.values()
                                  if o["method"] == "GET" and "write" not in o["effects"]
                                  and o["capability"] != "public"})
    reader_values = ",".join(json.dumps(scope) for scope in reader_capabilities)
    return """package dev.protocolia.generated;
@org.springframework.context.annotation.Configuration
@org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
public class SecurityConfig {
    @org.springframework.context.annotation.Bean
    org.springframework.security.web.SecurityFilterChain chain(org.springframework.security.config.annotation.web.builders.HttpSecurity http) throws Exception {
        http.csrf(org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer::disable);
        http.sessionManagement(s -> s.sessionCreationPolicy(org.springframework.security.config.http.SessionCreationPolicy.STATELESS));
        http.authorizeHttpRequests(a -> {
""" + permits + """
            a.anyRequest().authenticated();
        });
        http.httpBasic(org.springframework.security.config.Customizer.withDefaults());
        return http.build();
    }
    @org.springframework.context.annotation.Bean
    org.springframework.security.core.userdetails.UserDetailsService accounts() {
        String user=System.getenv("PROTOCOLIA_USER");
        String password=System.getenv("PROTOCOLIA_PASSWORD");
        String scopes=System.getenv("PROTOCOLIA_SCOPES");
        if (user==null || user.isBlank() || password==null || password.length()<16 || scopes==null || scopes.isBlank())
            throw new IllegalStateException("Require PROTOCOLIA_USER, PROTOCOLIA_PASSWORD >=16 chars and PROTOCOLIA_SCOPES");
        var authorities=java.util.Arrays.stream(scopes.split(",")).map(String::trim)
            .filter(s->!s.isEmpty()).toArray(String[]::new);
        var encoder=new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder();
        var details=org.springframework.security.core.userdetails.User.withUsername(user)
            .password("{bcrypt}"+encoder.encode(password)).authorities(authorities).build();
        String reader=System.getenv("PROTOCOLIA_VIEWER_USER");
        String readerPassword=System.getenv("PROTOCOLIA_VIEWER_PASSWORD");
        if ((reader==null)!=(readerPassword==null))
            throw new IllegalStateException("Both PROTOCOLIA_VIEWER_USER and PROTOCOLIA_VIEWER_PASSWORD required");
        if (reader!=null) {
            if (reader.isBlank() || readerPassword.length()<16 || reader.equals(user))
                throw new IllegalStateException("Invalid isolated read-only test identity");
            String[] readerAuthorities = new String[]{""" + reader_values + """};
            if (readerAuthorities.length == 0)
                throw new IllegalStateException("No declared read-only GET capability for demonstration viewer");
            var viewer=org.springframework.security.core.userdetails.User.withUsername(reader)
                .password("{bcrypt}"+encoder.encode(readerPassword)).authorities(readerAuthorities).build();
            return new org.springframework.security.provisioning.InMemoryUserDetailsManager(details,viewer);
        }
        return new org.springframework.security.provisioning.InMemoryUserDetailsManager(details);
    }
}
"""

POM="""<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
<modelVersion>4.0.0</modelVersion>
<parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.0.2</version><relativePath/></parent>
<groupId>dev.protocolia</groupId><artifactId>generated-service</artifactId><version>0.3.0</version>
<properties><java.version>21</java.version></properties><dependencies>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-webmvc</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-validation</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-security</artifactId></dependency>
<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
<dependency><groupId>org.springframework.security</groupId><artifactId>spring-security-test</artifactId><scope>test</scope></dependency>
</dependencies>
<build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build>
</project>
"""

def generate_java(contract: Any) -> dict[str,str]:
    ir=validate(contract)
    if ir["version"] not in {"0.2", "0.3"}: _fail("Java target requires v0.2 or v0.3")
    outputs={"pom.xml":POM,"contract-ir.json":_json(ir),
        "src/main/resources/application.properties":"spring.application.name=protocolia-generated\nserver.error.include-message=never\nspring.jackson.deserialization.fail-on-unknown-properties=true\n",
        SRC+"GeneratedApplication.java":("package "+PKG+";\n@org.springframework.boot.autoconfigure.SpringBootApplication\n"
           "public class GeneratedApplication { public static void main(String[] args) { "
           "org.springframework.boot.SpringApplication.run(GeneratedApplication.class,args); } }\n"),
        SRC+"ContractController.java":controller(ir["operations"]),
        SRC+"ContractHandlers.java":handler_interface(ir["operations"]),
        SRC+"SecurityConfig.java":security(ir["operations"]),
        "README.md":("Generated Java 21 / Spring Boot 4 API with typed ContractHandlers business extension. Without a Spring bean implementing this port, handlers return 501. POST uses HTTP 201 by Java target convention. "
                     "Basic auth requires PROTOCOLIA_USER, PROTOCOLIA_PASSWORD (>=16 chars) and PROTOCOLIA_SCOPES. "
                     "This demonstration configuration is not a production identity provider.\n")}
    for name,fields in ir["models"].items():
        outputs[SRC+name+".java"]=record(name,fields)
    return dict(sorted(outputs.items()))

def _java_owned_path(name: str) -> Path:
    """Restrict manifest-owned paths, including untrusted old-manifest entries."""
    if not isinstance(name, str):
        _fail("invalid Java artifact path")
    path = Path(name)
    if (path.is_absolute() or not name or ".." in path.parts or "." in path.parts
            or not (name in {"pom.xml", "contract-ir.json", "README.md"}
                    or name.startswith("src/") and len(path.parts) >= 3)):
        _fail("unsafe generated path")
    return path


def _check_java_output_path(out: Path, relative: Path) -> Path:
    dest = out / relative
    current = dest
    while current != out:
        if current.is_symlink():
            _fail("symlink Java output path: " + str(relative))
        current = current.parent
    return dest


def write_java(files: dict[str, str], out: Path) -> None:
    """Regenerate owned files, including model additions/removals, without erasing custom code.

    A preflight validates *all* previous generated hashes and all newly claimed paths.
    An old or corrupt manifest fails closed. The manifest is replaced last; filesystem
    interruption mid-commit remains a detectable inconsistency rather than a claim
    of transactional multi-file updates.
    """
    out = Path(out)
    for path in (out, *out.parents):
        if path.is_symlink():
            _fail("symlink Java output directory")
    if not isinstance(files, dict) or any(not isinstance(value, str) for value in files.values()):
        _fail("invalid Java generated artifacts")
    for name in files:
        _java_owned_path(name)
    out.mkdir(parents=True, exist_ok=True)
    manifest = out / "protocolia-java-manifest.json"
    if manifest.is_symlink():
        _fail("manifest symlink")
    previous: dict[str, str] = {}
    if manifest.exists():
        try:
            old = json.loads(manifest.read_text(encoding="utf-8"))
            if (not isinstance(old, dict) or old.get("generator") != "java-spring/0.4"
                    or not isinstance(old.get("artifacts"), dict)):
                _fail("Java output ownership mismatch")
            previous = old["artifacts"]
            for name, digest in previous.items():
                rel = _java_owned_path(name)
                if (not isinstance(digest, str) or len(digest) != 64
                        or any(ch not in "0123456789abcdef" for ch in digest)):
                    _fail("invalid Java output manifest")
                dest = _check_java_output_path(out, rel)
                if not dest.is_file() or hashlib.sha256(dest.read_bytes()).hexdigest() != digest:
                    _fail("modified Java output: " + name)
        except (OSError, ValueError, TypeError, KeyError):
            _fail("invalid Java output manifest")

    # Before writing anything, ensure that newly generated paths do not take
    # ownership of handwritten files (even after adding/removing contract models).
    for name in files:
        dest = _check_java_output_path(out, _java_owned_path(name))
        if name not in previous and (dest.exists() or dest.is_symlink()):
            _fail("unmanaged Java project file: " + name)

    staged: list[tuple[Path, Path]] = []
    tmp_manifest: Path | None = None
    try:
        for name, content in files.items():
            dest = out / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=".protocolia-java-")
            tmp_path = Path(tmp)
            staged.append((tmp_path, dest))
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                stream.write(content)

        next_manifest = {
            "generator": "java-spring/0.4",
            "artifacts": {name: hashlib.sha256(body.encode()).hexdigest()
                          for name, body in files.items()},
        }
        fd, manifest_tmp = tempfile.mkstemp(dir=out, prefix=".protocolia-manifest-")
        tmp_manifest = Path(manifest_tmp)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(next_manifest, indent=2, sort_keys=True) + "\n")

        for tmp, dest in staged:
            os.replace(tmp, dest)
        for old_name in sorted(previous.keys() - files.keys()):
            (out / old_name).unlink()
        os.replace(tmp_manifest, manifest)
    finally:
        for tmp, _ in staged:
            tmp.unlink(missing_ok=True)
        if tmp_manifest is not None:
            tmp_manifest.unlink(missing_ok=True)
