"""P4 local Codex/Claude subscription runner: prepares and measures real CLI sessions.

NEVER authenticates a model, creates API keys, runs in CI or executes generated
candidate code. Only an independent, separately run grader may score the result.
The local workspace is NOT an OS isolation boundary: run untrusted projects in
a disposable external VM/container with a restricted identity.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

from .p4_benchmark import BenchmarkError, canonical, create, deny, load, packet, read, trace_summary

MAX_TRACE_BYTES = 16_000_000
FORBIDDEN_AUTH_ENV = (
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CODEX_API_KEY",
    "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
)


def _real_folder(folder: Path, label: str) -> Path:
    if not folder.is_absolute() or folder.is_symlink() or not folder.is_dir():
        deny(label + " must be an existing absolute non-symlink directory")
    return folder.resolve(strict=True)


def _separate(a: Path, b: Path) -> None:
    if a == b or a in b.parents or b in a.parents:
        deny("workspace and independent verifier must be disjoint")


def _git_head(folder: Path) -> str:
    proc = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD"], cwd=folder,
        text=True, capture_output=True, timeout=8, check=False,
    )
    if proc.returncode or len(proc.stdout.strip()) != 40:
        deny("fixture checkout has no usable pinned Git commit")
    return proc.stdout.strip()


def _task(frozen: dict, run_id: str, fixture_checkout: Path) -> dict:
    chosen = packet(frozen, run_id)["task"]
    if chosen["source_repo"] != frozen["protocol"]["verification"]["repo"]:
        deny("task and verifier repositories differ")
    if _git_head(fixture_checkout) != chosen["source_commit"]:
        deny("fixture checkout must be at exact locked Git commit")
    spec_file = fixture_checkout / "benchmarks" / "p4" / "tasks" / (chosen["id"] + ".json")
    if spec_file.is_symlink() or not spec_file.is_file():
        deny("task fixture missing or linked")
    data = spec_file.read_bytes()
    if hashlib.sha256(data).hexdigest() != chosen["spec_sha256"]:
        deny("task spec hash does not match frozen preregistration")
    if len(data) > 250_000:
        deny("unbounded task specification")
    task = read(spec_file)
    if task.get("id") != chosen["id"] or task.get("stratum") != chosen["stratum"]:
        deny("task spec identity changed")
    if not isinstance(task.get("requirements"), list) or not task["requirements"]:
        deny("task has no requirements")
    return task


def _prompt(frozen: dict, run_id: str, task: dict) -> str:
    chosen = packet(frozen, run_id)
    assignment = chosen["assignment"]
    # Each arm receives the exact same task and budget; arm-specific tool hints
    # are a preregistered treatment, NOT hidden grader instructions.
    instructions = {
        "direct": "Use direct coding only. Do not use ProtocolIA or OpenAPI Generator.",
        "conventional": (
            "Use conventional templates and OpenAPI Generator 7.20.0 when appropriate. "
            "Do NOT use ProtocolIA."
        ),
        "protocolia": (
            "Use the already-pinned ProtocolIA contract generator where relevant, "
            "then implement all unsupported domain behavior yourself. An HTTP 501 "
            "scaffold is not a completed endpoint. Do NOT use the conventional generator."
        ),
    }[assignment["arm"]]
    return (
        "You are in a fresh, disposable Java 21/Spring Boot 4 workspace. "
        "Implement the exact TASK.json requirements. No API keys or vendor SDKs. "
        "Do not fetch or inspect independently held-out grader tests, other arms "
        "or previous trial outputs. Do not access files outside this workspace. "
        "Run your own local checks, but never change task requirements. "
        "Use normal CLI sandboxing; do not escalate permissions. "
        f"Trial arm: {assignment['arm']}. Treatment: {instructions}\n"
        f"Trial budget: {json.dumps(frozen['protocol']['budget'],sort_keys=True)}.\n"
        "TASK.json below is the only source of functional requirements:\n"
        + json.dumps(task, sort_keys=True, ensure_ascii=False, indent=2)
        + "\n"
    )


def prepare(lock_file: Path, run_id: str, fixture_checkout: Path,
            runs_root: Path, evidence_root: Path) -> dict:
    frozen = load(lock_file)
    fixture = _real_folder(fixture_checkout, "independent fixture checkout")
    root = _real_folder(runs_root, "trial root")
    private = _real_folder(evidence_root, "private evidence root")
    _separate(fixture, root)
    _separate(fixture, private)
    _separate(root, private)
    task = _task(frozen, run_id, fixture)
    chosen = packet(frozen, run_id)
    folder = root / run_id
    evidence = private / run_id
    if folder.exists() or folder.is_symlink() or evidence.exists() or evidence.is_symlink():
        deny("existing trial may never be overwritten or reused")
    folder.mkdir(mode=0o700)
    workspace = folder / "workspace"
    workspace.mkdir(mode=0o700)
    evidence.mkdir(mode=0o700)
    task_bytes = canonical(task)
    prompt_text = _prompt(frozen, run_id, task)
    (workspace / "TASK.json").write_bytes(task_bytes)
    (evidence / "prompt.txt").write_text(prompt_text, encoding="utf-8")
    manifest = {
        "version": "p4-local-1", "run_id": run_id,
        "assignment": chosen["assignment"],
        "task_original_sha256": chosen["task"]["spec_sha256"],
        "workspace_task_sha256": hashlib.sha256(task_bytes).hexdigest(),
        "prompt_sha256": hashlib.sha256(prompt_text.encode()).hexdigest(),
        "verifier_commit": frozen["protocol"]["verification"]["commit"],
        "worktree": str(workspace), "evidence": str(evidence),
    }
    create(evidence / "prepared.json", manifest)
    # The worktree contains only the task spec; git used for CLI workspace
    # detection, not for execution or network publishing.
    result = subprocess.run(["git", "init", "-q"], cwd=workspace,
                            text=True, capture_output=True, timeout=15, check=False)
    if result.returncode:
        deny("could not initialize local candidate Git repository")
    return {"run_id": run_id, "workspace": str(workspace),
            "prompt": str(evidence / "prompt.txt"),
            "status": "prepared", "engine": chosen["assignment"]["engine"]}


def _cli_argv(engine: str, model: str | None) -> list[str]:
    if engine == "codex":
        # Codex CLI: no --yolo, no danger-full-access, no API client.
        cmd = ["codex", "exec", "--json", "--sandbox", "workspace-write",
               "--ask-for-approval", "never"]
        if model: cmd += ["--model", model]
        return cmd + ["-"]
    if engine == "claude":
        # CLI --permission-mode acceptEdits is NOT a sandbox! Host must provide
        # its own isolation, and non-edit tool approvals are denied in -p mode.
        cmd = ["claude", "-p", "--output-format", "json",
               "--no-session-persistence", "--permission-mode", "acceptEdits"]
        if model: cmd += ["--model", model]
        return cmd  # Claude print mode reads the prompt on stdin
    deny("unsupported subscription engine")


def execute(root: Path, evidence_root: Path, lock_file: Path, run_id: str, *,
            model: str | None = None, timeout_seconds: int | None = None,
            allow_real_cli: bool = False) -> dict:
    if allow_real_cli is not True:
        deny("running a logged-in coding agent requires explicit --execute consent")
    # Explicit opt-in is essential because this consumes user's quota.
    if any(os.environ.get(k) for k in FORBIDDEN_AUTH_ENV):
        deny("provider API-key or alternate billing env detected; use subscription login only")
    folder = _real_folder(root, "trial root") / run_id
    if folder.is_symlink() or not folder.is_dir():
        deny("prepared trial missing")
    workspace = _real_folder(folder / "workspace", "trial workspace")
    evidence = _real_folder(evidence_root, "private evidence root") / run_id
    evidence = _real_folder(evidence, "private trial evidence")
    _separate(workspace, evidence)
    frozen = load(lock_file)
    prepared = read(evidence / "prepared.json")
    assignment = packet(frozen, run_id)["assignment"]
    if (prepared["assignment"] != assignment or prepared["worktree"] != str(workspace)
            or prepared["evidence"] != str(evidence)):
        deny("trial manifest is stale or tampered")
    if workspace.parent != folder:
        deny("incorrect worktree path")
    if any((evidence / n).exists() for n in ("started.json", "run.json")):
        deny("trial already started: no automatic retries, preserve failed attempt")
    cli = assignment["engine"]
    binary = shutil.which(cli)
    if binary is None:
        deny("no logged-in " + cli + " CLI installed; trial remains unstarted")
    version = subprocess.run([binary, "--version"], capture_output=True,
                             text=True, timeout=12, check=False)
    if version.returncode:
        deny("could not inspect CLI version")
    if type(model) is not str or not model.strip() or len(model) > 100:
        deny("model must be explicitly pinned for all comparable trials")
    allowed = frozen["protocol"]["budget"]["max_seconds"]
    if type(timeout_seconds) is not int and timeout_seconds is not None:
        deny("invalid timeout")
    if timeout_seconds is not None and not 1 <= timeout_seconds <= allowed:
        deny("runner timeout exceeds preregistered ceiling")
    timeout = timeout_seconds or allowed
    prompt = (evidence / "prompt.txt").read_text("utf-8")
    if (hashlib.sha256(prompt.encode()).hexdigest()!=prepared["prompt_sha256"] or
        hashlib.sha256((workspace / "TASK.json").read_bytes()).hexdigest()
            != prepared["workspace_task_sha256"]):
        deny("frozen task or prompt modified before running CLI")
    args = [binary, *_cli_argv(cli, model)[1:]]
    # No shell interpolation. The command args themselves are metadata only.
    started = {"version": "p4-started-1", "assignment": assignment,
               "engine_version": version.stdout.strip()[:200],
               "model_requested": model, "argv": args[1:],
               "timeout_seconds": timeout, "started_epoch_s": time.time()}
    create(evidence / "started.json", started)  # fail closed before launching
    begin = time.monotonic()
    timed_out = False
    stdout = evidence / "cli-trace.private"
    stderr = evidence / "cli-stderr.private"
    with stdout.open("xb") as out, stderr.open("xb") as err:
        proc = subprocess.Popen(
            args, cwd=workspace, stdin=subprocess.PIPE, stdout=out, stderr=err,
            start_new_session=True, text=True, env=os.environ.copy())
        try:
            proc.communicate(prompt, timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            # Terminate the process group, NOT only the parent CLI. This
            # prevents orphaned local build/agent subprocesses on timeout.
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            proc.communicate()
    elapsed = time.monotonic()-begin
    bytes_written = stdout.stat().st_size
    usage = None
    warning = None
    if bytes_written > MAX_TRACE_BYTES:
        warning = "trace too large; usage unknown (private trace retained)"
    else:
        try: usage = trace_summary(stdout.read_text("utf-8"), cli)
        except (ValueError, UnicodeDecodeError) as exc:
            warning = "CLI output not parseable (" + type(exc).__name__ + ")"
    execution = {"version": "p4-cli-run-1", "run_id": run_id,
                 "cli_version": version.stdout.strip()[:200],
                 "model_requested": model, "wall_seconds": round(elapsed,3),
                 "exit_code": proc.returncode, "timed_out": timed_out,
                 "trace_sha256": hashlib.sha256(stdout.read_bytes()).hexdigest(),
                 "trace_bytes": bytes_written,
                 "tokens": None if usage is None else usage["observed_tokens"],
                 "usage_warning": warning, "verifier_status": "NOT_RUN"}
    create(evidence / "run.json", execution)
    return {"run_id":run_id, "exit_code":proc.returncode, "timed_out":timed_out,
            "seconds":execution["wall_seconds"],"trace":str(stdout),
            "verifier_status":"NOT_RUN", "warning":warning}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m protocolia.p4_local_runner")
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--lock", type=Path, required=True)
    prep.add_argument("--run-id", required=True)
    prep.add_argument("--fixtures", type=Path, required=True)
    prep.add_argument("--runs-root", type=Path, required=True)
    prep.add_argument("--evidence-root", type=Path, required=True)
    go = sub.add_parser("run")
    go.add_argument("--lock", type=Path, required=True)
    go.add_argument("--run-id", required=True)
    go.add_argument("--runs-root", type=Path, required=True)
    go.add_argument("--evidence-root", type=Path, required=True)
    go.add_argument("--model",required=True)
    go.add_argument("--timeout-seconds", type=int)
    go.add_argument("--execute", action="store_true",
                    help="I consent to consume my authenticated CLI subscription quota")
    a = parser.parse_args(argv)
    try:
        result = (prepare(a.lock,a.run_id,a.fixtures,a.runs_root,a.evidence_root)
                  if a.command=="prepare" else
                  execute(a.runs_root,a.evidence_root,a.lock,a.run_id,model=a.model,
                          timeout_seconds=a.timeout_seconds,allow_real_cli=a.execute))
        print(json.dumps(result,sort_keys=True,indent=2))
    except (BenchmarkError,OSError,subprocess.SubprocessError,ValueError) as exc:
        print("P4 local runner: "+str(exc),file=sys.stderr)
        return 2
    return 0

if __name__=="__main__":
    raise SystemExit(main())
