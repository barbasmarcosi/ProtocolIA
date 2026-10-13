"""G5: conservative, provider-free full-stack regeneration orchestrator.

External compilers are user-supplied, pinned tools. They only run inside
disposable staging directories; the final output is an ENTIRELY managed root.
No handwritten domain, migrations, HTTP transport or UI source is overwritten.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any

from . import core
from .compatibility import compare_contracts
from .resource_bundle import compile_resource_bundle, compare_resource_bundles

OWNERSHIP = "protocolia-fullstack/1"
JAVA_PROPERTIES = (
    "library=spring-boot,delegatePattern=true,useSpringBoot4=true,"
    "useJackson3=true,useResponseEntity=false,useSpringBuiltInValidation=true,"
    "useTags=true,openApiNullable=false,useSwaggerUI=false,"
    "annotationLibrary=none,documentationProvider=none,"
    "hideGenerationTimestamp=true,apiPackage=dev.protocolia.upstream.api,"
    "modelPackage=dev.protocolia.upstream.model,basePackage=dev.protocolia.upstream"
)
JAVA_FILES = ("apis,models,apiTests=false,modelTests=false,apiDocs=false,"
              "modelDocs=false,supportingFiles=ApiUtil.java")


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json(value: Any) -> str:
    return core._json(value)


def _guard(path: Path) -> None:
    for part in (path, *path.parents):
        if part.is_symlink():
            core._fail("fullstack output contains symlink: " + str(part))


def _files(root: Path) -> dict[str, bytes]:
    if not root.is_dir() or root.is_symlink():
        core._fail("not a plain generated directory: " + str(root))
    result: dict[str, bytes] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            core._fail("generated symlink not supported: " + str(path))
        if path.is_file():
            result[path.relative_to(root).as_posix()] = path.read_bytes()
        elif not path.is_dir():
            core._fail("unsupported generated filesystem type")
    return result


def _owned(out: Path) -> dict[str, str] | None:
    _guard(out)
    if not out.exists():
        return None
    if not out.is_dir():
        core._fail("managed output is not a directory")
    files = _files(out)
    manifest_raw = files.pop("fullstack-manifest.json", None)
    source_raw = files.get("source-contract.json")
    if not manifest_raw or not source_raw:
        core._fail("unmanaged output: missing ownership manifest/source")
    try:
        manifest = json.loads(manifest_raw)
        if manifest.get("generator") != OWNERSHIP or not isinstance(manifest.get("artifacts"), dict):
            core._fail("invalid fullstack ownership manifest")
        known = manifest["artifacts"]
        if set(known) != set(files) or any(
            not isinstance(digest, str) or _digest(files[name]) != digest
            for name, digest in known.items()
        ):
            core._fail("generated output modified, missing or contains unmanaged files")
        if manifest.get("sourceSha256") != _digest(source_raw):
            core._fail("source-contract snapshot hash mismatch")
    except (ValueError, TypeError, KeyError) as exc:
        core._fail("malformed ownership manifest: " + str(exc))
    return {"source": source_raw.decode("utf-8"), "digest": _digest(manifest_raw)}


def _run(args: list[str], cwd: Path, timeout: int = 480) -> None:
    try:
        subprocess.run(args, cwd=cwd, check=True, timeout=timeout,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except (subprocess.CalledProcessError, OSError, subprocess.TimeoutExpired) as e:
        detail = getattr(e, "stdout", None) or getattr(e, "output", None) or b""
        excerpt = detail.decode("utf-8", errors="replace")[-2400:] if isinstance(detail, bytes) else str(detail)[-2400:]
        core._fail("fullstack generator failed: " + " ".join(args[:4]) + "\n" + excerpt)


def _java(spec: Path, jar: Path, root: Path) -> dict[str, bytes]:
    # The generator is a replaceable external tool, but the executed release
    # must match the exact version accepted by this adapter.
    try:
        version = subprocess.run(
            ["java", "-jar", str(jar), "version"], cwd=root, check=True,
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
    except (subprocess.CalledProcessError, OSError, subprocess.TimeoutExpired) as exc:
        core._fail("unable to verify pinned Java generator: " + str(exc))
    if version != "7.26.0":
        core._fail("unsupported OpenAPI Generator version: " + repr(version))
    def generate(target: Path) -> dict[str, bytes]:
        _run(["java", "-jar", str(jar), "generate", "-g", "spring",
              "-i", str(spec), "-o", str(target),
              "--additional-properties=" + JAVA_PROPERTIES,
              "--global-property=" + JAVA_FILES], root)
        return _files(target / "src/main/java")
    first = generate(root / "spring-a")
    second = generate(root / "spring-b")
    if not first or first != second or not any(p.endswith("ApiDelegate.java") for p in first):
        core._fail("upstream Java source not complete or not byte-identical")
    return first


def _orval(spec: Path, template: Path, root: Path) -> dict[str, bytes]:
    web = root / "web-work"
    (web / "src/api").mkdir(parents=True)
    (web / "src/generated/orval").mkdir(parents=True)
    for relative in ("package.json", "package-lock.json", "orval.config.ts", "src/api/http.ts"):
        source = template / relative
        _guard(source)
        if not source.is_file():
            core._fail("missing pinned Orval template input: " + relative)
        target = web / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    shutil.copyfile(spec, web / "openapi.json")
    package = json.loads((web / "package.json").read_text())
    if package.get("devDependencies", {}).get("orval") != "8.41.0":
        core._fail("unsupported Orval pin; update adapter with explicit review")
    _run(["npm", "ci", "--no-audit", "--no-fund"], web)
    _run(["npm", "run", "generate"], web)
    first = _files(web / "src/generated/orval")
    _run(["npm", "run", "generate"], web)
    second = _files(web / "src/generated/orval")
    if not first or first != second or not any(p.endswith(".ts") for p in first):
        core._fail("Orval output missing or not byte-identical")
    return first


def regenerate_fullstack(contract: dict, resources: dict, domain_errors: dict,
                         *, out: Path, java_generator_jar: Path,
                         web_template: Path) -> dict:
    """All-or-reject managed-root regeneration and compatible contract evolution.

    Generation may be slow, but the previous managed root remains untouched
    until every compiler and ownership guard has passed. No external executable
    receives authority to write to that previous root.
    """
    out = Path(out).absolute()
    java_generator_jar = Path(java_generator_jar).resolve(strict=True)
    web_template = Path(web_template).resolve(strict=True)
    if not java_generator_jar.is_file() or not web_template.is_dir():
        core._fail("missing pinned generator or web template")
    out.parent.mkdir(parents=True, exist_ok=True)
    previous = _owned(out)
    if previous is not None:
        old = json.loads(previous["source"])
        comparison = compare_contracts(old["contract"], contract)
        semantic = compare_resource_bundles(old["contract"], old["resources"], contract, resources)
        if not comparison["compatible"] or not semantic["compatible"]:
            core._fail("breaking contract/resource change; regenerate rejected")
    artifacts = compile_resource_bundle(contract, resources, domain_errors)
    workspace = Path(tempfile.mkdtemp(dir=out.parent, prefix=".protocolia-g5-stage-"))
    moved_previous: Path | None = None
    try:
        stage = workspace / "managed"
        stage.mkdir()
        bundle = stage / "bundle"
        bundle.mkdir()
        for name, value in artifacts.items():
            (bundle / name).write_text(value, encoding="utf-8")
        src = stage / "source-contract.json"
        src.write_text(_json({"contract": contract, "resources": resources,
                              "domainErrors": domain_errors}), encoding="utf-8")
        java = _java(bundle / "openapi.json", java_generator_jar, workspace)
        ts = _orval(bundle / "openapi.json", web_template, workspace)
        for group, files in (("java/src/main/java", java), ("web/src/generated/orval", ts)):
            for rel, body in files.items():
                path = stage / group / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
        contents = _files(stage)
        digest = {name: _digest(body) for name, body in sorted(contents.items())}
        (stage / "fullstack-manifest.json").write_text(_json({
            "generator": OWNERSHIP,
            "sourceSha256": digest["source-contract.json"],
            "artifacts": digest,
        }), encoding="utf-8")
        if previous is not None:
            # Revalidate ownership just before commit: no silently lost edits.
            if _owned(out) != previous:
                core._fail("concurrent modification to previously generated output")
            moved_previous = workspace / "prior-managed"
            out.rename(moved_previous)
        try:
            stage.rename(out)
        except OSError:
            if moved_previous is not None:
                moved_previous.rename(out)
                moved_previous = None
            raise
        return {"state": "GENERATED", "files": len(digest),
                "javaFiles": len(java), "typescriptFiles": len(ts),
                "reproducible": True, "output": str(out)}
    finally:
        if moved_previous is not None and moved_previous.exists() and not out.exists():
            moved_previous.rename(out)
        shutil.rmtree(workspace, ignore_errors=True)
