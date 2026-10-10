"""P4 local runner: no actual coding subscription, only simulated CLI binaries.

CI proves frozen task import, external evidence separation, explicit real-run
consent, env denial, process timeout and no automatic reusing a run ID.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from protocolia.p4_benchmark import BenchmarkError, lock, create
from protocolia.p4_local_runner import (
    FORBIDDEN_AUTH_ENV, _cli_argv, prepare, execute,
)


class LocalRunnerTests(unittest.TestCase):
    def setUp(self):
        td=tempfile.TemporaryDirectory(prefix="p4-fake-cli-")
        self.addCleanup(td.cleanup)
        self.root=Path(td.name)
        self.fixture=self.root/"consumer"
        self.fixture.mkdir()
        spec={"id":"catalog-crud","stratum":"greenfield",
              "description":"independent fake Java HTTP task",
              "requirements":["POST /api/books returns correct data","duplicate ISBN is 409"],
              "prohibited":["reading the private grader"],"language":"Java 21 Spring Boot 4"}
        task_dir=self.fixture/"benchmarks/p4/tasks"
        task_dir.mkdir(parents=True)
        source=task_dir/"catalog-crud.json"
        source.write_text(json.dumps(spec)+"\n")
        subprocess.run(["git","init","-q"],cwd=self.fixture,check=True)
        subprocess.run(["git","add","."],cwd=self.fixture,check=True)
        subprocess.run(["git","-c","user.name=Test","-c","user.email=test@example.invalid",
                        "commit","-qm","frozen fixture"],cwd=self.fixture,check=True)
        commit=subprocess.run(["git","rev-parse","HEAD"],cwd=self.fixture,
                              capture_output=True,text=True,check=True).stdout.strip()
        proto={"version":"p4-1","study":"fake-cli-pilot","rounds":3,
              "engines":["codex","claude"],"arms":["direct","conventional","protocolia"],
              "tasks":[
               {"id":id,"stratum":stratum,"spec_sha256":"e"*64,
                "source_repo":"external/test","source_commit":commit,
                "description":"Independent experimental task "+id}
               for id,stratum in [
                ("catalog-crud","greenfield"),("quota-idempotency","invariants"),
                ("contract-evolution","compatibility")]],
              "budget":{"max_seconds":120,"max_interventions":0,"max_repairs":0},
              "verification":{"repo":"external/test","commit":commit,
                              "contract":"separate evaluator"},
              "analysis":{"primary":"verified_success_rate",
                          "secondary":["wall_seconds_per_verified_success",
                                       "observed_cli_tokens"],
                          "decision":"No winner without full comparisons"},
              "tools":{"protocolia_commit":"pinned","conventional_generator":"pinned"}}
        proto["tasks"][0]["spec_sha256"]=hashlib.sha256(source.read_bytes()).hexdigest()
        self.lock=self.root/"lock.json"
        create(self.lock,lock(proto))
        self.work=self.root/"work"
        self.work.mkdir()
        self.private=self.root/"private"
        self.private.mkdir(mode=0o700)
        self.runid="codex-catalog-crud-r01-direct"
        self.safeenv=os.environ.copy()
        for key in FORBIDDEN_AUTH_ENV:self.safeenv.pop(key,None)

    def prep(self,runid=None):
        return prepare(self.lock,runid or self.runid,self.fixture,self.work,self.private)

    def fake_cli(self,stream):
        command=self.root/"fake-cli"
        command.write_text(
            "#!"+sys.executable+"\n"
            "import json,sys\n"
            "if '--version' in sys.argv: print('fake-cli-v1');sys.exit(0)\n"
            "assert sys.stdin.read()\n"
            "print("+repr(stream)+")\n")
        command.chmod(0o700)
        return command

    def test_positive_isolated_prepared_task_and_immutable_metadata(self):
        result=self.prep()
        self.assertEqual(result["engine"],"codex")
        candidate=Path(result["workspace"])
        self.assertEqual(sorted(p.name for p in candidate.iterdir()),[".git","TASK.json"])
        self.assertIn("duplicate ISBN",Path(result["prompt"]).read_text())
        self.assertNotIn("p4_verify.py",str(candidate))
        self.assertNotIn("protocolia-sandbox",str(candidate))
        self.assertTrue((self.private/self.runid/"prepared.json").is_file())
        self.assertFalse((candidate/"evidence").exists())
        with self.assertRaises(BenchmarkError):self.prep()

    def test_signed_source_commit_and_frozen_sha_enforced(self):
        (self.fixture/"benchmarks/p4/tasks/catalog-crud.json").write_text('{"tampered":true}')
        with self.assertRaisesRegex(BenchmarkError,"hash"):self.prep()

    def test_no_real_cli_invoked_without_opt_in(self):
        self.prep()
        with self.assertRaisesRegex(BenchmarkError,"explicit"):
            execute(self.work,self.private,self.lock,self.runid)
        self.assertFalse((self.private/self.runid/"started.json").exists())

    def test_codex_fake_cli_trace_and_no_replay(self):
        self.prep()
        stub=self.fake_cli('{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":4,"cached_input_tokens":0}}')
        with patch.dict(os.environ,self.safeenv,clear=True),patch(
                "protocolia.p4_local_runner.shutil.which",return_value=str(stub)):
            result=execute(self.work,self.private,self.lock,self.runid,
                           allow_real_cli=True,model="test-model",timeout_seconds=10)
        self.assertEqual(result["exit_code"],0)
        self.assertFalse(result["timed_out"])
        private=self.private/self.runid
        record=json.loads((private/"run.json").read_text())
        self.assertEqual(record["tokens"]["input_tokens"],12)
        self.assertEqual(record["verifier_status"],"NOT_RUN")
        self.assertTrue((private/"cli-trace.private").exists())
        self.assertFalse((self.work/self.runid/"workspace"/"cli-trace.private").exists())
        with self.assertRaisesRegex(BenchmarkError,"already started"):
            execute(self.work,self.private,self.lock,self.runid,allow_real_cli=True)

    def test_known_provider_key_env_denied_before_start(self):
        self.prep()
        for key in ("OPENAI_API_KEY","ANTHROPIC_API_KEY"):
            with self.subTest(key=key),patch.dict(os.environ,{key:"fake-api-credential"}):
                with self.assertRaisesRegex(BenchmarkError,"API-key"):
                    execute(self.work,self.private,self.lock,self.runid,allow_real_cli=True)
        self.assertFalse((self.private/self.runid/"started.json").exists())

    def test_rejected_overlapping_fixture_and_workspace_root(self):
        with self.assertRaisesRegex(BenchmarkError,"disjoint"):
            prepare(self.lock,self.runid,self.fixture,self.fixture,self.private)
        with self.assertRaisesRegex(BenchmarkError,"disjoint"):
            prepare(self.lock,self.runid,self.fixture,self.work,self.work)

    def test_codex_and_claude_flags_exclude_sandbox_bypass(self):
        codex=_cli_argv("codex","test-model")
        claude=_cli_argv("claude","sonnet")
        self.assertIn("workspace-write",codex)
        self.assertEqual(codex[-1],"-")
        self.assertIn("acceptEdits",claude)
        self.assertIn("--no-session-persistence",claude)
        self.assertNotIn("--dangerously-skip-permissions",claude)
        self.assertNotIn("--yolo",codex)
        self.assertNotIn("-",claude)

    def test_fake_claude_usage_and_no_subscription_dollars(self):
        ident="claude-catalog-crud-r01-direct"
        self.prep(ident)
        stub=self.fake_cli('{"type":"result","usage":{"input_tokens":13,"output_tokens":7},"total_cost_usd":4.5}')
        with patch.dict(os.environ,self.safeenv,clear=True),patch(
                "protocolia.p4_local_runner.shutil.which",return_value=str(stub)):
            result=execute(self.work,self.private,self.lock,ident,allow_real_cli=True)
        self.assertEqual(result["exit_code"],0)
        info=json.loads((self.private/ident/"run.json").read_text())
        self.assertEqual(info["tokens"]["output_tokens"],7)
        self.assertNotIn("actual_subscription_usd",info)

    def test_timeout_is_counted_not_autoretried(self):
        self.prep()
        stub=self.root/"fake-slow"
        stub.write_text("#!"+sys.executable+"\nimport sys,time\nsys.stdin.read();time.sleep(10)\n")
        stub.chmod(0o700)
        with patch.dict(os.environ,self.safeenv,clear=True),patch(
                "protocolia.p4_local_runner.shutil.which",return_value=str(stub)):
            info=execute(self.work,self.private,self.lock,self.runid,
                         allow_real_cli=True,timeout_seconds=1)
        self.assertTrue(info["timed_out"])
        self.assertNotEqual(info["exit_code"],0)
        self.assertTrue((self.private/self.runid/"run.json").exists())

if __name__=="__main__":unittest.main()
