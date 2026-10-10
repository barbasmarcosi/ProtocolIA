"""P3-B2.2: actual Ed25519 operator signatures, no declared-identity bypass."""
import base64
import copy
import hashlib
import json
import os
import secrets
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from protocolia.action_runtime import ExecutionDenied, _json
from protocolia.operator_auth import (
    CONTEXT, approve_signed, create_intent, run_signed, revoke_signed,
)

ROOT=Path(__file__).resolve().parents[1]
PLAN=json.loads((ROOT/"examples/broker-plan-v0.5.json").read_text())
HOST=json.loads((ROOT/"examples/broker-host-policy-v0.5.json").read_text())
DOCKER=json.loads((ROOT/"examples/broker-docker-policy-v0.5.json").read_text())

class SignedOperatorTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root=Path(tmp.name)
        self.inputs=root/"inputs"
        (self.inputs/"warehouse").mkdir(parents=True)
        (self.inputs/"warehouse"/"stock").write_bytes(b"abc")
        self.workspace=root/"ledger"
        self.workspace.mkdir()
        self.secret_file=root/"host-secret"
        self.secret_file.write_bytes(secrets.token_bytes(32))
        self.secret_file.chmod(0o600)
        self.registry_file=root/"operator-registry.json"
        self.private=Ed25519PrivateKey.generate()
        self.other=Ed25519PrivateKey.generate()
        public=self.private.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        self.registry={"version":"0.6","operators":{
            "alice":{"enabled":True,"resources":["warehouse/stock"],"keys":{
                "laptop1":{"ed25519_public_b64":base64.b64encode(public).decode(),
                           "revoked":False}}}}}
        self.write_registry()
        self.plan=copy.deepcopy(PLAN)
        self.host=copy.deepcopy(HOST)
        self.docker=copy.deepcopy(DOCKER)
        self.calls=0
        self.intent=self.make_intent()
        self.envelope=self.sign()
    def write_registry(self):
        self.registry_file.write_text(json.dumps(self.registry))
        self.registry_file.chmod(0o600)
    def make_intent(self,nonce=None):
        return create_intent(self.plan,self.host,self.docker,self.inputs,self.registry_file,
            subject="alice",key_id="laptop1",environment="ci-host",
            issued_at=100,expires_at=200,nonce=nonce or "c"*32)
    def sign(self,private=None,intent=None):
        data=intent if intent is not None else self.intent
        sig=(private or self.private).sign(CONTEXT+_json(data).encode())
        return {"intent":copy.deepcopy(data),"signature_b64":base64.b64encode(sig).decode()}
    def kwargs(self):
        return {"registry_file":self.registry_file,"service_key_file":self.secret_file,
                "host_environment":"ci-host","now":lambda:101.0}
    def approve(self,envelope=None):
        return approve_signed(envelope if envelope is not None else self.envelope,
            self.plan,self.host,self.docker,self.inputs,self.workspace,**self.kwargs())
    def fake_runner(self,argv,**kwargs):
        self.calls+=1
        self.assertEqual(argv[:2],["docker","run"])
        self.assertEqual(argv[argv.index("--network")+1],"none")
        self.assertIn("--read-only",argv)
        self.assertEqual(argv[argv.index("--pull")+1],"never")
        return SimpleNamespace(returncode=0,stdout=json.dumps({
            "sha256":hashlib.sha256(b"abc").hexdigest(),"bytes":3}))
    def execute_signed(self,envelope=None):
        return run_signed(envelope if envelope is not None else self.envelope,
            self.plan,self.host,self.docker,self.inputs,self.workspace,
            runner=self.fake_runner,**self.kwargs())
    def test_signed_approval_then_exactly_one_external_read_and_replay(self):
        with self.assertRaises(ExecutionDenied):self.execute_signed()
        a=self.approve()
        self.assertEqual(a["status"],"approved-operator")
        first=self.execute_signed()
        self.assertEqual(first["operator"],"alice")
        self.assertEqual(first["operator_key_id"],"laptop1")
        self.assertEqual(first["status"],"executed")
        self.assertEqual(first["outputs"]["verify"],True)
        second=self.execute_signed()
        self.assertEqual(second["status"],"replayed")
        self.assertEqual(self.calls,1)
        with sqlite3.connect(self.workspace/"protocolia-sandbox.sqlite3") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM operator_receipts").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM attempts").fetchone()[0],1)
    def test_attacker_cannot_assert_identity_without_signature(self):
        for envelope in ({**self.envelope,"signature_b64":""},
                         self.sign(private=self.other)):
            with self.subTest(envelope=envelope),self.assertRaises(ExecutionDenied):
                self.approve(envelope)
        self.assertEqual(self.calls,0)
        self.assertFalse(list(self.workspace.iterdir()))
    def test_signed_intent_binds_plan_and_host_permissions(self):
        self.plan["actions"][1]["args"]["value"]="tampered"
        with self.assertRaisesRegex(ExecutionDenied,"stale"):
            self.approve()
        self.plan=copy.deepcopy(PLAN)
        self.host["max_duration_ms"]+=1
        with self.assertRaisesRegex(ExecutionDenied,"stale"):
            self.approve()
    def test_wrong_key_or_operator_resource_cannot_authorize(self):
        self.registry["operators"]["alice"]["resources"]=[]
        self.write_registry()
        with self.assertRaisesRegex(ExecutionDenied,"not authorized"):self.approve()
    def test_key_revocation_blocks_even_existing_completed_replay(self):
        self.approve()
        self.assertEqual(self.execute_signed()["status"],"executed")
        self.registry["operators"]["alice"]["keys"]["laptop1"]["revoked"]=True
        self.write_registry()
        with self.assertRaises(ExecutionDenied):self.execute_signed()
        self.assertEqual(self.calls,1)
    def test_disabled_user_blocks_approval(self):
        self.registry["operators"]["alice"]["enabled"]=False
        self.write_registry()
        with self.assertRaisesRegex(ExecutionDenied,"disabled"):self.approve()
    def test_expired_and_future_dated_signed_intent_rejected(self):
        expired=self.kwargs()
        expired["now"]=lambda:201.0
        with self.assertRaisesRegex(ExecutionDenied,"expired"):
            approve_signed(self.envelope,self.plan,self.host,self.docker,
                           self.inputs,self.workspace,**expired)
        early=self.kwargs()
        early["now"]=lambda:99.0
        with self.assertRaisesRegex(ExecutionDenied,"valid"):
            approve_signed(self.envelope,self.plan,self.host,self.docker,
                           self.inputs,self.workspace,**early)
    def test_wrong_environment_or_credential_file_permissions_denied(self):
        kw=self.kwargs()
        kw["host_environment"]="wrong-host"
        with self.assertRaisesRegex(ExecutionDenied,"environment"):
            approve_signed(self.envelope,self.plan,self.host,self.docker,
                           self.inputs,self.workspace,**kw)
        self.secret_file.chmod(0o644)
        with self.assertRaisesRegex(ExecutionDenied,"private"):
            self.approve()
        self.secret_file.chmod(0o600)
        self.registry_file.chmod(0o666)
        with self.assertRaisesRegex(ExecutionDenied,"private"):
            self.approve()
    def test_symlinked_secret_and_registry_fail(self):
        alias=self.secret_file.parent/"alias-secret"
        alias.symlink_to(self.secret_file)
        kw=self.kwargs()
        kw["service_key_file"]=alias
        with self.assertRaisesRegex(ExecutionDenied,"symlink"):
            approve_signed(self.envelope,self.plan,self.host,self.docker,
                           self.inputs,self.workspace,**kw)
    def test_unique_nonce_cannot_issue_two_different_approvals(self):
        self.approve()
        self.plan["plan_id"]="distinct-audit"
        fresh=self.make_intent(nonce="c"*32)
        with self.assertRaisesRegex(ExecutionDenied,"consumed"):
            self.approve(self.sign(intent=fresh))
    def test_wrong_signer_revoke_denied_and_valid_revoke_blocks(self):
        self.approve()
        wrong=self.sign(private=self.other)
        with self.assertRaises(ExecutionDenied):
            revoke_signed(wrong,self.plan,self.host,self.docker,self.inputs,
                          self.workspace,**self.kwargs())
        revoke_signed(self.envelope,self.plan,self.host,self.docker,self.inputs,
                      self.workspace,**self.kwargs())
        with self.assertRaisesRegex(ExecutionDenied,"revoked"):self.execute_signed()
    def test_rotation_changes_registry_binding_and_blocks_old_key(self):
        self.approve()
        new=self.other.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        self.registry["operators"]["alice"]["keys"]["laptop2"]={
            "ed25519_public_b64":base64.b64encode(new).decode(),"revoked":False}
        self.write_registry()
        with self.assertRaisesRegex(ExecutionDenied,"stale"):
            self.execute_signed()
        self.assertEqual(self.calls,0)
    def test_signed_replay_does_not_accept_tampered_envelope(self):
        self.approve()
        bad=copy.deepcopy(self.envelope)
        bad["intent"]["expires_at"]-=1
        with self.assertRaises(ExecutionDenied):self.execute_signed(bad)
