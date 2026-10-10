"""P3-B2.1: typed DAG -> host sealed, single read-only external action."""
import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

from protocolia.action_broker import (
    ExecutionDenied, approve_plan, preview_plan, run_plan, validate_broker_plan,
)
from protocolia.sandbox_adapter import revoke

ROOT = Path(__file__).resolve().parents[1]
PLAN = json.loads((ROOT / "examples/broker-plan-v0.5.json").read_text())
HOST = json.loads((ROOT / "examples/broker-host-policy-v0.5.json").read_text())
SANDBOX = json.loads((ROOT / "examples/broker-docker-policy-v0.5.json").read_text())
SECRET = b"HOST-NOT-MODEL-approval-secret-key-32-bytes"

class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        self.inputs=root/"inputs"
        (self.inputs/"warehouse").mkdir(parents=True)
        (self.inputs/"warehouse"/"stock").write_bytes(b"abc")
        self.workspace=root/"approvals"
        self.workspace.mkdir()
        self.plan=copy.deepcopy(PLAN)
        self.host=copy.deepcopy(HOST)
        self.sandbox=copy.deepcopy(SANDBOX)
        self.calls=[]
        self.identity={"subject":"ci-operator","environment":"test-sandbox-host",
                       "secret":SECRET,"now":lambda:100.0}

    def fake_runner(self,argv,**kwargs):
        self.calls.append(argv)
        self.assertEqual(argv[:2],["docker","run"])
        self.assertEqual(argv[argv.index("--network")+1],"none")
        self.assertIn("--read-only",argv)
        self.assertIn("--cap-drop",argv)
        self.assertEqual(argv[argv.index("--pull")+1],"never")
        self.assertEqual(argv[argv.index("--user")+1],"65534:65534")
        self.assertEqual(kwargs["timeout"],10.0)
        mount=argv[argv.index("--mount")+1]
        source=mount.split("source=")[1].split(",target=")[0]
        self.assertEqual(Path(source).read_bytes(),b"abc")
        return SimpleNamespace(returncode=0, stdout=json.dumps({
            "sha256":hashlib.sha256(b"abc").hexdigest(),"bytes":3}))

    def approved(self):
        return approve_plan(self.plan,self.host,self.sandbox,self.inputs,self.workspace,
                            **self.identity)
    def executed(self,**kw):
        return run_plan(self.plan,self.host,self.sandbox,self.inputs,self.workspace,
                        runner=self.fake_runner,**self.identity,**kw)

    def test_dag_executes_one_approved_external_read_and_replays(self):
        p=preview_plan(self.plan,self.host,self.sandbox,self.inputs)
        self.assertEqual(p["external_timeout_ms"],10000)
        self.assertEqual(p["order"],["expected","read","verify"])
        self.assertFalse(list(self.workspace.iterdir()))
        a=self.approved()
        self.assertEqual(a["external_request_id"],p["external_request"]["request_id"])
        first=self.executed()
        second=self.executed()
        self.assertEqual(first["status"],"executed")
        self.assertEqual(second["status"],"replayed")
        self.assertIs(first["outputs"]["verify"],True)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(first["outputs"],second["outputs"])
        with sqlite3.connect(self.workspace/"protocolia-sandbox.sqlite3") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM attempts").fetchone()[0],1)

    def test_no_approval_must_not_run(self):
        with self.assertRaisesRegex(ExecutionDenied,"approval ledger"):
            self.executed()
        self.assertFalse(list(self.workspace.iterdir()))

    def test_tampered_plan_never_reuses_original_approval(self):
        self.approved()
        original=preview_plan(self.plan,self.host,self.sandbox,self.inputs)
        self.plan["actions"][1]["args"]["value"]="0"*64
        modified=preview_plan(self.plan,self.host,self.sandbox,self.inputs)
        self.assertNotEqual(original["external_request"]["request_id"],
                            modified["external_request"]["request_id"])
        with self.assertRaisesRegex(ExecutionDenied,"approval"):
            self.executed()
        self.assertEqual(self.calls,[])

    def test_policy_or_resource_changes_cannot_escalate(self):
        self.approved()
        self.host["max_duration_ms"]=16000
        with self.assertRaisesRegex(ExecutionDenied,"approval"):self.executed()
        self.host=copy.deepcopy(HOST)
        self.host["grants"]["file.sha256"]=[]
        with self.assertRaisesRegex(ExecutionDenied,"resource denied"):
            preview_plan(self.plan,self.host,self.sandbox,self.inputs)
        self.assertEqual(self.calls,[])

    def test_never_executes_unexpected_writes_shells_or_multiple_externals(self):
        c=copy.deepcopy(self.plan)
        c["actions"][0]["tool"]="shell"
        with self.assertRaisesRegex(ExecutionDenied,"forbidden broker tool"):
            validate_broker_plan(c)
        c=copy.deepcopy(self.plan)
        c["actions"][0]["effects"]=["write"]
        with self.assertRaisesRegex(ExecutionDenied,"forged"):
            validate_broker_plan(c)
        c=copy.deepcopy(self.plan)
        c["actions"].append(copy.deepcopy(c["actions"][0]))
        c["actions"][-1]["id"]="second-read"
        with self.assertRaisesRegex(ExecutionDenied,"exactly one"):
            validate_broker_plan(c)
        c=copy.deepcopy(self.plan)
        c["actions"][2]["depends_on"]=["read"]
        with self.assertRaisesRegex(ExecutionDenied,"unbound"):
            validate_broker_plan(c)

    def test_wrong_operator_or_secret_denied(self):
        self.approved()
        with self.assertRaises(ExecutionDenied):
            run_plan(self.plan,self.host,self.sandbox,self.inputs,self.workspace,
                     subject="attacker",environment=self.identity["environment"],
                     secret=SECRET,now=lambda:100.0,runner=self.fake_runner)
        with self.assertRaises(ExecutionDenied):
            run_plan(self.plan,self.host,self.sandbox,self.inputs,self.workspace,
                     subject=self.identity["subject"],environment=self.identity["environment"],
                     secret=b"fake-signature-key-at-least-32-bytes",now=lambda:100.0,
                     runner=self.fake_runner)
        self.assertEqual(self.calls,[])

    def test_revoked_and_stale_inputs_fail_closed(self):
        approval=self.approved()
        path=self.inputs/"warehouse"/"stock"
        path.write_bytes(b"tampered")
        with self.assertRaisesRegex(ExecutionDenied,"stale"):self.executed()
        path.write_bytes(b"abc")
        revoke(approval["external_request_id"],self.workspace,secret=SECRET)
        with self.assertRaisesRegex(ExecutionDenied,"revoked"):self.executed()
        self.assertEqual(self.calls,[])

    def test_expired_grant_does_not_execute(self):
        self.approved()
        with self.assertRaisesRegex(ExecutionDenied,"expired"):
            run_plan(self.plan,self.host,self.sandbox,self.inputs,self.workspace,
                     subject=self.identity["subject"],environment=self.identity["environment"],
                     secret=SECRET,now=lambda:1000.0,runner=self.fake_runner)
        self.assertEqual(self.calls,[])

    def test_concurrent_clients_produce_single_external_attempt(self):
        self.approved()
        def invoke(_):
            try:return self.executed()["status"]
            except ExecutionDenied as e:
                self.assertIn("quarantined",str(e))
                return "running"
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses=list(pool.map(invoke,[1,2]))
        self.assertIn("executed",statuses)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.executed()["status"],"replayed")

    def test_postcondition_failure_does_not_retry_external_operation(self):
        self.plan["actions"][1]["args"]["value"]="bad-expected"
        self.approved()
        with self.assertRaisesRegex(ExecutionDenied,"assertion failed"):self.executed()
        with self.assertRaisesRegex(ExecutionDenied,"assertion failed"):self.executed()
        self.assertEqual(len(self.calls),1)

    def test_spend_must_be_known_zero_and_pure_dry_run_has_no_approval(self):
        self.sandbox["max_spend_usd"]=None
        with self.assertRaises(ExecutionDenied):
            preview_plan(self.plan,self.host,self.sandbox,self.inputs)
        self.assertFalse(list(self.workspace.iterdir()))
