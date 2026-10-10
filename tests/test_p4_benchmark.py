"""P4 offline subscription CLI preregistration/economics negative-conformance."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from protocolia.p4_benchmark import (
    BenchmarkError, check, lock, load, create, packet, assignments,
    trace_summary, record, report, read
)


def experiment():
    return {
      "version":"p4-1","study":"subscriptions-research-a","rounds":3,
      "engines":["codex","claude"],"arms":["direct","conventional","protocolia"],
      "tasks":[
        {"id":"first-task","stratum":"greenfield","spec_sha256":"a"*64,
         "source_repo":"external-test","source_commit":"test-sha",
         "description":"Add a greenfield REST resource with correct validation"},
        {"id":"second-task","stratum":"brownfield","spec_sha256":"b"*64,
         "source_repo":"external-test","source_commit":"test-sha",
         "description":"Modify an existing service without changing old behavior"},
        {"id":"third-task","stratum":"invariants","spec_sha256":"c"*64,
         "source_repo":"external-test","source_commit":"test-sha",
         "description":"Enforce invariants under real concurrent requests"}
      ],
      "budget":{"max_seconds":1200,"max_interventions":2,"max_repairs":3},
      "verification":{"repo":"external-test","commit":"verifier-sha",
                      "contract":"externally validated HTTP behavior"},
      "analysis":{"primary":"verified_success_rate",
                  "secondary":["wall_seconds_per_verified_success","observed_cli_tokens"],
                  "decision":"No winner if runs are missing or USD unavailable"},
      "tools":{"protocolia_commit":"pinned-sha","conventional_generator":"openapi-generator-7.20.0"},
    }


class P4SubscriptionBenchmark(unittest.TestCase):
    def setUp(self):
        self.proto=experiment()
        self.frozen=lock(self.proto)
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)

    def test_balanced_preregistered_assignments(self):
        a=assignments(self.proto)
        self.assertEqual(a,assignments(self.proto))
        self.assertEqual(len(a),54)
        self.assertEqual(len(set(j["run_id"] for j in a)),54)
        for engine in ("codex","claude"):
            for task in self.proto["tasks"]:
                for r in (1,2,3):
                    v=[x for x in a if x["engine"]==engine and x["task_id"]==task["id"] and x["repeat"]==r]
                    self.assertEqual({x["arm"] for x in v},{"direct","protocolia","conventional"})
                    self.assertEqual(sorted(x["order"] for x in v),[1,2,3])

    def test_locked_manifest_is_immutable_and_no_overwrite(self):
        file=self.path/"lock.json"
        create(file,self.frozen)
        self.assertEqual(load(file),self.frozen)
        with self.assertRaises(BenchmarkError):create(file,self.frozen)
        modified=read(file);modified["protocol"]["rounds"]=4
        file.write_text(json.dumps(modified))
        with self.assertRaisesRegex(BenchmarkError,"altered"):load(file)

    def test_packets_are_arm_specific_without_api_keys(self):
        for j in self.frozen["assignments"][:3]:
            p=packet(self.frozen,j["run_id"])
            self.assertEqual(p["assignment"],j)
            self.assertIn(j["task_id"],p["task"]["id"])
            self.assertIn("no API keys",p["prompt"])
        with self.assertRaises(BenchmarkError):packet(self.frozen,"made-up-run")

    def test_claude_reported_api_equivalent_not_subscription_billing(self):
        output=json.dumps({"type":"result","result":"sensitive contents",
                           "usage":{"input_tokens":10,"output_tokens":15,
                                    "cache_read_input_tokens":4},
                           "total_cost_usd":0.07},indent=2)
        x=trace_summary(output,"claude")
        self.assertEqual(x["observed_tokens"]["input_tokens"],10)
        self.assertEqual(x["api_equivalent_usd_not_billed"],0.07)
        self.assertIsNone(x["actual_subscription_usd"])
        self.assertNotIn("sensitive contents",str(x))

    def test_codex_turn_usage_and_absent_token_telemetry(self):
        output="\n".join(json.dumps(t) for t in (
          {"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":5,"cached_input_tokens":2}},
          {"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":7,"cached_input_tokens":1}}
        ))
        x=trace_summary(output,"codex")
        self.assertEqual(x["observed_tokens"],{"input_tokens":21,"output_tokens":12,
                                               "cached_input_tokens":3})
        self.assertIsNone(trace_summary('{"type":"turn.completed"}',"codex")["observed_tokens"]["input_tokens"])

    def test_duplicate_and_malformed_traces_rejected(self):
        for engine,trace in (("codex","nonjson"),("codex",'{"type":"turn.completed","type":"result"}'),
                              ("claude",'{"type":"result"}\n{"type":"result"}')):
            with self.subTest(engine=engine),self.assertRaises(BenchmarkError):
                trace_summary(trace,engine)

    def test_verifier_evidence_budget_failure_remains_in_denominator(self):
        job=self.frozen["assignments"][0]
        proof={"verifier_commit":"verifier-sha","tests_passed":True,
               "security_passed":True,"evidence_sha256":"d"*64,"independent":True}
        result=record(self.frozen,job["run_id"],proof,"Codex CLI 1","model-a",
                      1201,0,0,0)
        self.assertFalse(result["verified_success"])
        summary=report(self.frozen,[result])
        self.assertEqual(summary["recorded"],1)
        self.assertFalse(summary["complete"])
        self.assertIn("no winner",summary["decision"])
        self.assertIsNone(summary["subscription_usd_per_success"])
        with self.assertRaisesRegex(BenchmarkError,"duplicate"):report(self.frozen,[result,result])
        proof["verifier_commit"]="wrong"
        with self.assertRaises(BenchmarkError):
            record(self.frozen,job["run_id"],proof,"codex","model",5,0,0,0)

    def test_invalid_manifest_or_tasks_fail_closed(self):
        changes=[
            lambda p:p.update(rounds=1),
            lambda p:p.update(arms=["direct","protocolia"]),
            lambda p:p["tasks"][0].update(spec_sha256="not-hash"),
            lambda p:p["tasks"][1].update(id=p["tasks"][0]["id"]),
            lambda p:p["budget"].update(max_seconds=True),
        ]
        for func in changes:
            p=copy.deepcopy(self.proto);func(p)
            with self.assertRaises(BenchmarkError):check(p)

    def test_no_missing_token_as_zero_and_no_hardcoded_model_billing(self):
        p=self.frozen
        job=next(a for a in p["assignments"] if a["engine"]=="claude")
        proof={"verifier_commit":"verifier-sha","tests_passed":True,
               "security_passed":True,"evidence_sha256":"e"*64,"independent":True}
        trace=json.dumps({"type":"result","result":"sensitive","usage":{"output_tokens":33}})
        value=record(p,job["run_id"],proof,"Claude Code","claude-subscription",
                     99,0,0,1,trace)
        self.assertTrue(value["verified_success"])
        self.assertIsNone(value["usage"]["observed_tokens"]["input_tokens"])
        self.assertNotIn("sensitive",str(value))

if __name__=="__main__":unittest.main()
