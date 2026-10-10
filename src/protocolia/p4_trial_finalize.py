"""P4 finalize: independently grade one already-executed local subscribed CLI trial.

This NEVER invokes an agent or runs untrusted generated Java code. The operator
starts a disposable candidate server separately, ideally in a locked-down VM.
A pinned independent verifier on localhost produces evidence; missing/failed
verifiers are NOT silently re-labeled as independent proof.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from .p4_benchmark import (
    BenchmarkError, create, deny, load, packet, read, record,
)
from .p4_local_runner import _git_head, _real_folder, _separate


def finalize(lock_file: Path, run_id: str, runs_root: Path,
             evidence_root: Path, results_root: Path,
             verifier_checkout: Path, *, base_url: str,
             interventions: int, repairs: int) -> dict:
    frozen=load(lock_file)
    chosen=packet(frozen,run_id)
    run_folder=_real_folder(runs_root,"work root") / run_id
    if not run_folder.is_dir() or run_folder.is_symlink():
        deny("trial workspace missing")
    workspace=_real_folder(run_folder/"workspace","candidate worktree")
    evidence=_real_folder(evidence_root,"evidence root") / run_id
    evidence=_real_folder(evidence,"trial evidence")
    verifier=_real_folder(verifier_checkout,"independent grader checkout")
    results=_real_folder(results_root,"published results root")
    for outside in (verifier,results,evidence):
        _separate(workspace,outside)
    _separate(verifier,evidence)
    _separate(verifier,results)
    if _git_head(verifier)!=frozen["protocol"]["verification"]["commit"]:
        deny("verifier Git checkout no longer matches study commit")
    check=subprocess.run(["git","status","--porcelain","--untracked-files=all"],
                         cwd=verifier,capture_output=True,text=True,timeout=10,check=False)
    if check.returncode or check.stdout:
        deny("verifier checkout has modified or untracked files")
    proof_script=verifier/"tools"/"p4_verify.py"
    if not proof_script.is_file() or proof_script.is_symlink():
        deny("pinned independent verifier script unavailable")
    prepared=read(evidence/"prepared.json")
    run=read(evidence/"run.json")
    if (prepared["assignment"]!=chosen["assignment"] or
            prepared["verifier_commit"]!=frozen["protocol"]["verification"]["commit"] or
            run["run_id"]!=run_id or
            run["version"]!="p4-cli-run-1" or
            run.get("verifier_status")!="NOT_RUN"):
        deny("stale local CLI evidence")
    if (type(interventions) is not int or interventions<0 or
            type(repairs) is not int or repairs<0):
        deny("manual intervention counts must be nonnegative integers")
    if type(run["model_requested"]) is not str or not run["model_requested"]:
        deny("actual requested model not recorded; cannot compare matched trials")
    trace=evidence/"cli-trace.private"
    if not trace.is_file() or trace.is_symlink():
        deny("CLI trace absent")
    if hashlib.sha256(trace.read_bytes()).hexdigest()!=run["trace_sha256"]:
        deny("CLI trace modified since CLI invocation")
    verdict=evidence/"independent-verdict.json"
    if verdict.exists() or verdict.is_symlink() or (results/(run_id+".json")).exists():
        deny("verifier already attempted or result exists; no silent trial reuse")
    # This marker precedes ALL verification actions, so a crash is visible.
    create(evidence/"verification-started.json",
           {"run_id":run_id,"verifier_commit":frozen["protocol"]["verification"]["commit"],
            "task_id":chosen["assignment"]["task_id"],"base_url":base_url})
    args=[sys.executable,str(proof_script),"--task",chosen["assignment"]["task_id"],
          "--base-url",base_url,"--verifier-commit",
          frozen["protocol"]["verification"]["commit"],"--out",str(verdict)]
    # Run the verifier without the candidate worktree as cwd. Its loopback
    # allowlist refuses remote/production URLs. Never invoke Java/JAR/Bash here.
    completed=subprocess.run(args,cwd=verifier,stdin=subprocess.DEVNULL,
                             capture_output=True,text=True,timeout=90,check=False)
    if completed.returncode not in (0,1) or not verdict.is_file():
        deny("independent grader did not produce valid pass/fail evidence")
    verification=read(verdict)
    if verification["tests_passed"] is True and completed.returncode!=0:
        deny("grader status and evidence conflict")
    if verification["tests_passed"] is False and completed.returncode==0:
        deny("grader status and evidence conflict")
    # A missing/malformed CLI trace is not proof of zero usage. Preserve its
    # hash in private run.json and score the verified task with unknown tokens.
    trace_text=None
    if trace.stat().st_size<=10_000_000 and not run["usage_warning"]:
        trace_text=trace.read_text("utf-8")
    result=record(
        frozen,run_id,verification,run["cli_version"],run["model_requested"],
        run["wall_seconds"],run["exit_code"],interventions,repairs,trace_text)
    create(results/(run_id+".json"),result)
    return {"run_id":run_id,"verified_success":result["verified_success"],
            "verifier_passed":verification["tests_passed"],"result":str(results/(run_id+".json")),
            "subscription_usd":None}


def main(argv=None) -> int:
    parser=argparse.ArgumentParser(prog="python -m protocolia.p4_trial_finalize")
    for name in ("lock","runs-root","evidence-root","results-root","verifier-checkout"):
        parser.add_argument("--"+name,type=Path,required=True)
    parser.add_argument("--run-id",required=True)
    parser.add_argument("--base-url",required=True)
    parser.add_argument("--interventions",type=int,required=True)
    parser.add_argument("--repairs",type=int,required=True)
    a=parser.parse_args(argv)
    try:
        result=finalize(a.lock,a.run_id,a.runs_root,a.evidence_root,a.results_root,
                        a.verifier_checkout,base_url=a.base_url,
                        interventions=a.interventions,repairs=a.repairs)
        print(json.dumps(result,indent=2,sort_keys=True))
    except (BenchmarkError,OSError,ValueError,subprocess.SubprocessError) as exc:
        print("p4 independent finalize: "+str(exc),file=sys.stderr)
        return 2
    return 0

if __name__=="__main__":raise SystemExit(main())
