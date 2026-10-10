"""Provider-free Java 21 / Spring Boot 4 source generator (strict bounded subset)."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any
from .core import ContractError, _fail, _json
from .v02 import validate

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

def controller(ops: dict) -> str:
    endpoints=[]
    for name,op in ops.items():
        if name in BAD: _fail("unsupported Java operation name: "+name)
        params=[]
        for key,typ in op["params"].items():
            if key in BAD: _fail("unsupported Java parameter name: "+key)
            params.append('@org.springframework.web.bind.annotation.PathVariable("'+key+'") '+jt(typ)+' '+key)
        if "request" in op:
            params.append("@jakarta.validation.Valid @org.springframework.web.bind.annotation.RequestBody "+op["request"]+" body")
        auth=('@org.springframework.security.access.prepost.PreAuthorize("hasAuthority('+
              "'"+op["capability"]+"'"+')")\n    ') if op["capability"]!="public" else ""
        endpoints.append('    '+auth+'@org.springframework.web.bind.annotation.RequestMapping(path="'+
             op["path"]+'",method=org.springframework.web.bind.annotation.RequestMethod.'+op["method"]+')\n'+
             '    public '+op["response"]+' '+name+'('+", ".join(params)+') {\n'+
             '        throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_IMPLEMENTED,"business handler missing");\n    }')
    return ("package "+PKG+";\n@org.springframework.web.bind.annotation.RestController\n"+
            "public class ContractController {\n"+"\n\n".join(endpoints)+"\n}\n")

def security(ops: dict) -> str:
    permits="\n".join('            a.requestMatchers(org.springframework.http.HttpMethod.'+o["method"]+', "'+o["path"]+'").permitAll();'
                      for o in ops.values() if o["capability"]=="public")
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
            var viewer=org.springframework.security.core.userdetails.User.withUsername(reader)
                .password("{bcrypt}"+encoder.encode(readerPassword)).authorities("products.read").build();
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
    if ir["version"]!="0.2": _fail("Java target requires v0.2")
    outputs={"pom.xml":POM,"contract-ir.json":_json(ir),
        "src/main/resources/application.properties":"spring.application.name=protocolia-generated\nserver.error.include-message=never\nspring.jackson.deserialization.fail-on-unknown-properties=true\n",
        SRC+"GeneratedApplication.java":("package "+PKG+";\n@org.springframework.boot.autoconfigure.SpringBootApplication\n"
           "public class GeneratedApplication { public static void main(String[] args) { "
           "org.springframework.boot.SpringApplication.run(GeneratedApplication.class,args); } }\n"),
        SRC+"ContractController.java":controller(ir["operations"]),
        SRC+"SecurityConfig.java":security(ir["operations"]),
        "README.md":("Generated Java 21 / Spring Boot 4 API skeleton. Business endpoints return 501. "
                     "Basic auth requires PROTOCOLIA_USER, PROTOCOLIA_PASSWORD (>=16 chars) and PROTOCOLIA_SCOPES. "
                     "This demonstration configuration is not a production identity provider.\n")}
    for name,fields in ir["models"].items():
        outputs[SRC+name+".java"]=record(name,fields)
    return dict(sorted(outputs.items()))

def write_java(files: dict[str,str],out: Path) -> None:
    out=Path(out)
    for path in (out,*out.parents):
        if path.is_symlink(): _fail("symlink Java output directory")
    for name in files:
        path=Path(name)
        if path.is_absolute() or ".." in path.parts or not (name in {"pom.xml","contract-ir.json","README.md"} or name.startswith("src/")):
            _fail("unsafe generated path")
    out.mkdir(parents=True,exist_ok=True)
    manifest=out/"protocolia-java-manifest.json"
    if manifest.is_symlink(): _fail("manifest symlink")
    if manifest.exists():
        try:
            old=json.loads(manifest.read_text())
            if old["generator"]!="java-spring/0.3" or set(old["artifacts"])!=set(files):
                _fail("Java output ownership mismatch")
            for path,digest in old["artifacts"].items():
                dest=out/path
                if dest.is_symlink() or not dest.is_file() or hashlib.sha256(dest.read_bytes()).hexdigest()!=digest:
                    _fail("modified Java output: "+path)
        except (OSError,KeyError,ValueError,TypeError):
            _fail("invalid Java output manifest")
    elif any((out/name).exists() or (out/name).is_symlink() for name in files):
        _fail("unmanaged Java project files")
    staged=[]
    try:
        for name,content in files.items():
            dest=out/name
            for p in dest.parents:
                if p == out: break
                if p.is_symlink(): _fail("nested Java output symlink")
            dest.parent.mkdir(parents=True,exist_ok=True)
            fd,tmp=tempfile.mkstemp(dir=dest.parent,prefix=".protocolia-java-")
            with os.fdopen(fd,"w",encoding="utf-8",newline="\n") as f:
                f.write(content)
            staged.append((Path(tmp),dest))
        for tmp,dest in staged: os.replace(tmp,dest)
        data={"generator":"java-spring/0.3","artifacts":{p:hashlib.sha256(v.encode()).hexdigest() for p,v in files.items()}}
        manifest.write_text(json.dumps(data,indent=2,sort_keys=True)+"\n")
    finally:
        for tmp,_ in staged: tmp.unlink(missing_ok=True)
