"""A minimal user-facing Java project initializer, independent of demo scripts.

The generated MVC layer is owned by ProtocolIA. The implementer's starter
handler belongs to the user and is never owned or overwritten by regeneration.
"""
from __future__ import annotations

from pathlib import Path

from .core import _fail
from .java_spring import PKG, generate_java, jt, write_java
from .v02 import validate

CUSTOM_FILE = Path("src/main/java/dev/protocolia/generated/custom/StarterHandlers.java")


def starter_handlers(operations: dict) -> str:
    methods = []
    for name, op in operations.items():
        parameters = [jt(typ) + " " + key for key, typ in op["params"].items()]
        if "request" in op:
            parameters.append(op["request"] + " body")
        methods.append(
            "    @Override\n    public " + op["response"] + " " + name +
            "(" + ", ".join(parameters) + ") {\n" +
            "        throw new org.springframework.web.server.ResponseStatusException(" +
            "org.springframework.http.HttpStatus.NOT_IMPLEMENTED, \"business handler missing\");\n" +
            "    }\n")
    return (
        "package " + PKG + ".custom;\n\n" +
        "import " + PKG + ".*;\n\n" +
        "/** USER-OWNED file: implement domain rules here. ProtocolIA never rewrites it. */\n" +
        "@org.springframework.stereotype.Service\n" +
        "public final class StarterHandlers implements ContractHandlers {\n" +
        "\n".join(methods) + "}\n"
    )


def init_java(contract: dict, out: Path) -> tuple[bool, int]:
    """Generate a real Maven module, and bootstrap a user-editable handler once.

    Returns (created_starter, generated_file_count). A changed contract may
    require the developer to update the custom interface implementation.
    """
    files = generate_java(contract)
    operations = validate(contract)["operations"]
    out = Path(out)
    starter = out / CUSTOM_FILE
    # Fail closed on suspicious existing custom paths BEFORE regeneration.
    for parent in (out, *out.parents):
        if parent.is_symlink():
            _fail("symlink Java output directory")
    for parent in (starter, *starter.parents):
        if parent == out:
            break
        if parent.is_symlink():
            _fail("symlink custom Java handler path")
    if starter.exists() and not starter.is_file():
        _fail("custom Java handler path is not a file")
    write_java(files, out)
    starter.parent.mkdir(parents=True, exist_ok=True)
    try:
        with starter.open("x", encoding="utf-8", newline="\n") as dest:
            dest.write(starter_handlers(operations))
        created = True
    except FileExistsError:
        # Existing user code is never modified, including on contract evolution.
        if starter.is_symlink() or not starter.is_file():
            _fail("unsafe existing custom Java handler")
        created = False
    return created, len(files)
