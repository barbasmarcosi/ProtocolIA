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
from protocolia.p4_trial_finalize import finalize


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
        verifier_tools=self.fixture/"tools"
        verifier_tools.mkdir()
        grader=verifier_tools/"p4_verify.py"
        grader.write_text(
            "import argparse,json\n"
            "from pathlib import Path\n"
            "p=argparse.ArgumentParser()\n"
            "p.add_argument('--task');p.add_argument('--base-url');p.add_argument('--verifier-commit');p.add_argument('--out')\n"
            "a=p.parse_args()\n"
            "ok=a.base_url.endswith('8765')\n"
            "e={'verifier_commit':a.verifier_commit,'tests_passed':ok,'security_passed':ok,'independent':True,'evidence_sha256':'a'*64}\n"
            "Path(a.out).write_text(json.dumps(e))\n"
            "raise SystemExit(0 if ok else 1)\n")
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
        self.results=self.root/"results"
        self.results.mkdir(mode=0o700)
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
            result=execute(self.work,self.private,self.lock,ident,allow_real_cli=True,model="sonnet")
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
                         allow_real_cli=True,timeout_seconds=1,model="pinned-codex")
        self.assertTrue(info["timed_out"])
        self.assertNotEqual(info["exit_code"],0)
        self.assertTrue((self.private/self.runid/"run.json").exists())


    def test_postrun_frozen_independent_verifier_and_publish_immutable_result(self):
        self.prep()
        stub=self.fake_cli('{"type":"turn.completed","usage":{"input_tokens":18,"output_tokens":6,"cached_input_tokens":0}}')
        with patch.dict(os.environ,self.safeenv,clear=True),patch(
                "protocolia.p4_local_runner.shutil.which",return_value=str(stub)):
            execute(self.work,self.private,self.lock,self.runid,
                    allow_real_cli=True,model="pinned-model")
        result=finalize(
            self.lock,self.runid,self.work,self.private,self.results,self.fixture,
            base_url="http://127.0.0.1:8765",interventions=0,repairs=0)
        self.assertTrue(result["verified_success"])
        published=json.loads((self.results/(self.runid+".json")).read_text())
        self.assertEqual(published["usage"]["observed_tokens"]["input_tokens"],18)
        self.assertEqual(published["repairs"],0)
        self.assertIsNone(published["usage"]["actual_subscription_usd"])
        with self.assertRaisesRegex(BenchmarkError,"already attempted"):
            finalize(self.lock,self.runid,self.work,self.private,self.results,self.fixture,
                     base_url="http://127.0.0.1:8765",interventions=0,repairs=0)

    def test_failing_external_grader_still_records_failure_not_cherrypicked(self):
        self.prep()
        stub=self.fake_cli('{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":4}}')
        with patch.dict(os.environ,self.safeenv,clear=True),patch(
                "protocolia.p4_local_runner.shutil.which",return_value=str(stub)):
            execute(self.work,self.private,self.lock,self.runid,
                    allow_real_cli=True,model="pinned-model")
        summary=finalize(self.lock,self.runid,self.work,self.private,self.results,self.fixture,
                         base_url="http://127.0.0.1:8766",interventions=0,repairs=0)
        self.assertFalse(summary["verified_success"])
        self.assertTrue((self.results/(self.runid+".json")).exists())

    def test_dirty_verifier_or_tampered_trace_denied_before_provenance(self):
        self.prep()
        stub=self.fake_cli('{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":9}}')
        with patch.dict(os.environ,self.safeenv,clear=True),patch(
                "protocolia.p4_local_runner.shutil.which",return_value=str(stub)):
            execute(self.work,self.private,self.lock,self.runid,
                    allow_real_cli=True,model="pinned-model")
        grader=self.fixture/"tools/p4_verify.py"
        grader.write_text("raise SystemExit(0)\n")
        with self.assertRaisesRegex(BenchmarkError,"modified"):
            finalize(self.lock,self.runid,self.work,self.private,self.results,self.fixture,
                     base_url="http://127.0.0.1:8765",interventions=0,repairs=0)
        subprocess.run(["git","checkout","--","tools/p4_verify.py"],cwd=self.fixture,check=True)
        trace=self.private/self.runid/"cli-trace.private"
        trace.write_text("manipulated")
        with self.assertRaisesRegex(BenchmarkError,"trace modified"):
            finalize(self.lock,self.runid,self.work,self.private,self.results,self.fixture,
                     base_url="http://127.0.0.1:8765",interventions=0,repairs=0)

    def test_model_must_be_pinned_and_prompt_cannot_be_tampered(self):
        self.prep()
        stub=self.fake_cli('{"type":"turn.completed"}')
        with patch.dict(os.environ,self.safeenv,clear=True),patch(
                "protocolia.p4_local_runner.shutil.which",return_value=str(stub)):
            with self.assertRaisesRegex(BenchmarkError,"model must be explicitly"):
                execute(self.work,self.private,self.lock,self.runid,allow_real_cli=True)
            (self.private/self.runid/"prompt.txt").write_text("malicious replacement")
            with self.assertRaisesRegex(BenchmarkError,"frozen task or prompt"):
                execute(self.work,self.private,self.lock,self.runid,
                        allow_real_cli=True,model="pinned-model")
        self.assertFalse((self.private/self.runid/"started.json").exists())

if __name__=="__main__":unittest.main()
