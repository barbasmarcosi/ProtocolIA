"""P3-B1 unit tests: host authorization, immutable input, revocation and quarantine."""
import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from protocolia.sandbox_adapter import ExecutionDenied, approve, preview, revoke, run

SECRET=b"operator-trusted-test-secret-at-least-32-bytes"
POL={"version":"0.5","allow":["warehouse/inventory"],"max_bytes":256,
     "timeout_ms":5000,"max_spend_usd":0,"container_image":"sha256:"+"a"*64}
REQ={"version":"0.5","request_id":"warehouse-test","tool":"file.sha256","resource":"warehouse/inventory"}

class BoundedDockerAdapterTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        self.inputs=root/"inputs"
        (self.inputs/"warehouse").mkdir(parents=True)
        (self.inputs/"warehouse"/"inventory").write_bytes(b"test-bytes")
        self.ledger=root/"ledger"
        self.ledger.mkdir()
        self.req=copy.deepcopy(REQ)
        self.policy=copy.deepcopy(POL)
        self.calls=[]
    def approve(self):
        return approve(self.req,self.policy,self.inputs,self.ledger,subject="operator",
                       environment="ci-runner",secret=SECRET,now=lambda:100.0)
    def runner(self,args,**kwargs):
        self.calls.append((args,kwargs))
        assert args[:2]==["docker","run"]
        for flag,expected in (("--network","none"),("--cap-drop","ALL"),
                              ("--pull","never"),("--user","65534:65534")):
            assert args[args.index(flag)+1]==expected, (flag,args)
        assert "--read-only" in args and "--pids-limit" in args
        assert "--security-opt" in args and "no-new-privileges:true" in args
        assert "--mount" in args and "target=/input,readonly" in args[args.index("--mount")+1]
        assert args[args.index(self.policy["container_image"])+1]=="python3"
        assert kwargs["timeout"]==5.0
        return SimpleNamespace(returncode=0,stdout=json.dumps({
            "sha256":hashlib.sha256(b"test-bytes").hexdigest(),"bytes":10}))
    def invoke(self,**kwargs):
        return run(self.req,self.policy,self.inputs,self.ledger,subject="operator",
                   environment="ci-runner",secret=SECRET,runner=self.runner,
                   now=lambda:100.0,**kwargs)
    def test_preview_is_read_only_and_approval_replay_once(self):
        p=preview(self.req,self.policy,self.inputs)
        self.assertEqual(p["estimated_cost_usd"],0)
        self.assertFalse(any(self.ledger.iterdir()))
        self.approve()
        self.assertEqual(self.invoke()["status"],"executed")
        self.assertEqual(self.invoke()["status"],"replayed")
        self.assertEqual(len(self.calls),1)
    def test_approval_cannot_be_forged(self):
        with self.assertRaises(ExecutionDenied):self.invoke()
        self.approve()
        with sqlite3.connect(self.ledger/"protocolia-sandbox.sqlite3") as db:
            db.execute("UPDATE approvals SET payload='{}'")
        with self.assertRaisesRegex(ExecutionDenied,"signature"):self.invoke()
        self.assertEqual(len(self.calls),0)
    def test_revocation_denies(self):
        self.approve()
        revoke(self.req["request_id"],self.ledger,secret=SECRET)
        with self.assertRaisesRegex(ExecutionDenied,"revoked"):self.invoke()
    def test_changed_host_policy_input_or_subject_denies(self):
        self.approve()
        (self.inputs/"warehouse"/"inventory").write_bytes(b"changed")
        with self.assertRaisesRegex(ExecutionDenied,"stale"):self.invoke()
        (self.inputs/"warehouse"/"inventory").write_bytes(b"test-bytes")
        self.policy["max_bytes"]=255
        with self.assertRaisesRegex(ExecutionDenied,"stale"):self.invoke()
        self.policy=copy.deepcopy(POL)
        with self.assertRaisesRegex(ExecutionDenied,"identity"):
            run(self.req,self.policy,self.inputs,self.ledger,subject="intruder",
                environment="ci-runner",secret=SECRET,runner=self.runner,now=lambda:100)
    def test_expiration_and_unique_approvals(self):
        self.approve()
        with self.assertRaisesRegex(ExecutionDenied,"expired"):
            run(self.req,self.policy,self.inputs,self.ledger,subject="operator",
                environment="ci-runner",secret=SECRET,runner=self.runner,now=lambda:900)
        with self.assertRaises(ExecutionDenied):self.approve()
    def test_failure_quarantined_no_repeat(self):
        self.approve()
        def failed(*args,**kwargs):
            self.calls.append((args,kwargs))
            return SimpleNamespace(returncode=3,stdout="")
        with self.assertRaisesRegex(ExecutionDenied,"quarantined"):
            run(self.req,self.policy,self.inputs,self.ledger,subject="operator",
                environment="ci-runner",secret=SECRET,runner=failed,now=lambda:100)
        with self.assertRaisesRegex(ExecutionDenied,"quarantined"):self.invoke()
        self.assertEqual(len(self.calls),1)
    def test_validation_denies_shell_paid_tools_and_path_escape(self):
        for resource in ("../secret","/etc/passwd","warehouse/../inventory",
                         "warehouse//inventory","warehouse\\foo"):
            r=copy.deepcopy(self.req);r["resource"]=resource
            with self.subTest(resource=resource), self.assertRaises(ExecutionDenied):
                preview(r,self.policy,self.inputs)
        r=copy.deepcopy(self.req);r["tool"]="shell.execute"
        with self.assertRaises(ExecutionDenied):preview(r,self.policy,self.inputs)
        p=copy.deepcopy(self.policy);p["max_spend_usd"]=1
        with self.assertRaises(ExecutionDenied):preview(self.req,p,self.inputs)
        p=copy.deepcopy(self.policy);p["container_image"]="python:latest"
        with self.assertRaises(ExecutionDenied):preview(self.req,p,self.inputs)
    def test_symlink_fifo_and_bounded_inputs_rejected(self):
        path=self.inputs/"warehouse"/"inventory"
        path.unlink()
        path.symlink_to("/etc/passwd")
        with self.assertRaises(ExecutionDenied):preview(self.req,self.policy,self.inputs)
        path.unlink()
        path.write_bytes(b"x"*257)
        with self.assertRaises(ExecutionDenied):preview(self.req,self.policy,self.inputs)
    def test_denied_identity_does_not_reserve_external_attempt(self):
        self.approve()
        with self.assertRaises(ExecutionDenied):
            run(self.req,self.policy,self.inputs,self.ledger,subject="operator",
                environment="wrong",secret=SECRET,runner=self.runner,now=lambda:100)
        with sqlite3.connect(self.ledger/"protocolia-sandbox.sqlite3") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM attempts").fetchone()[0],0)
        self.assertEqual(len(self.calls),0)
    def test_cancel_before_start_no_effect(self):
        self.approve()
        with self.assertRaisesRegex(ExecutionDenied,"cancelled"):
            self.invoke(cancelled=lambda:True)
        self.assertEqual(len(self.calls),0)
