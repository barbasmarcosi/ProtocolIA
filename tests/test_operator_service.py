"""P3-B3 gateway exercises actual SO_PEERCRED Unix socket and hostile callers."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import tempfile
import threading
import time
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from protocolia.action_runtime import ExecutionDenied, _json
from protocolia.operator_auth import CONTEXT
from protocolia.operator_service import ApprovalServer, client, dispatch, SOCK_NAME

ROOT=Path(__file__).resolve().parents[1]
PLAN=json.loads((ROOT/"examples/broker-plan-v0.5.json").read_text())
HOST=json.loads((ROOT/"examples/broker-host-policy-v0.5.json").read_text())
DOCKER=json.loads((ROOT/"examples/broker-docker-policy-v0.5.json").read_text())


class HostServiceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.inputs=self.root/"inputs"
        (self.inputs/"warehouse").mkdir(parents=True)
        (self.inputs/"warehouse"/"stock").write_bytes(b"abc")
        self.workspace=self.root/"workspace"
        self.workspace.mkdir(mode=0o700)
        self.key=Ed25519PrivateKey.generate()
        pub=self.key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        self.registry={"version":"0.6","operators":{"tester":{
            "enabled":True,"resources":["warehouse/stock"],"keys":{
                "device1":{"ed25519_public_b64":base64.b64encode(pub).decode(),
                           "revoked":False}}}}}
        self.registry_file=self.root/"registry.json"
        self.registry_file.write_text(json.dumps(self.registry))
        self.registry_file.chmod(0o600)
        self.secret_file=self.root/"secret.bin"
        self.secret_file.write_bytes(secrets.token_bytes(32))
        self.secret_file.chmod(0o600)
        self.host_file=self.root/"host.json"
        self.host_file.write_text(json.dumps(HOST))
        self.host_file.chmod(0o600)
        self.docker_file=self.root/"docker.json"
        self.docker_file.write_text(json.dumps(DOCKER))
        self.docker_file.chmod(0o600)
        self.config={"version":"0.6","inputs":str(self.inputs),
            "workspace":str(self.workspace),"registry_file":str(self.registry_file),
            "service_key_file":str(self.secret_file),
            "host_policy_file":str(self.host_file),
            "docker_policy_file":str(self.docker_file),
            "environment":"ci-host","allowed_uids":[os.geteuid()]}
        self.config_file=self.root/"server-config.json"
        self.save_config()
        self.plan=copy.deepcopy(PLAN)
    def save_config(self):
        self.config_file.write_text(json.dumps(self.config))
        self.config_file.chmod(0o600)
    def dispatch(self,msg,uid=None,runner=None):
        return dispatch(msg,self.config_file,peer_uid=os.geteuid() if uid is None else uid,
                        now=lambda:100.0,runner=runner)
    def prepare(self):
        return self.dispatch({"op":"prepare","plan":self.plan,
                              "subject":"tester","key_id":"device1"})["intent"]
    def sign(self,intent):
        signature=self.key.sign(CONTEXT+_json(intent).encode())
        return {"intent":intent,"signature_b64":base64.b64encode(signature).decode()}
    def test_preview_prepare_have_no_host_grant_or_receipt(self):
        result=self.dispatch({"op":"preview","plan":self.plan})
        self.assertEqual(result["status"],"preview-only")
        self.assertEqual(result["plan"]["estimated_cost_usd"],0)
        intent=self.prepare()
        self.assertEqual(intent["resource"],"warehouse/stock")
        self.assertEqual(intent["tool"],"file.sha256")
        self.assertEqual(intent["environment"],"ci-host")
        self.assertFalse((self.workspace/"protocolia-sandbox.sqlite3").exists())
    def test_untrusted_uid_denied_before_operations(self):
        with self.assertRaisesRegex(ExecutionDenied,"untrusted peer"):
            self.dispatch({"op":"preview","plan":self.plan},uid=os.geteuid()+1)
        self.assertFalse((self.workspace/"protocolia-sandbox.sqlite3").exists())
    def test_rpc_cannot_override_policy_or_keys(self):
        for extras in ({"host_policy":{"grants":{}}},{"secret":"injection"},
                       {"service_key_file":"/tmp/attacker"},{"inputs":"/etc"}):
            bad={"op":"preview","plan":self.plan,**extras}
            with self.subTest(extras=extras), self.assertRaises(ExecutionDenied):
                self.dispatch(bad)
        self.assertFalse((self.workspace/"protocolia-sandbox.sqlite3").exists())
    def test_signed_approval_and_no_model_self_grant(self):
        intent=self.prepare()
        msg={"op":"approve","plan":self.plan,"envelope":{
            "intent":intent,"signature_b64":base64.b64encode(secrets.token_bytes(64)).decode()}}
        with self.assertRaisesRegex(ExecutionDenied,"signature"):self.dispatch(msg)
        self.assertFalse((self.workspace/"protocolia-sandbox.sqlite3").exists())
        msg["envelope"]=self.sign(intent)
        approved=self.dispatch(msg)
        self.assertEqual(approved["status"],"approved-operator")
        self.assertEqual(approved["subject"],"tester")
    def test_host_config_policy_revocation_rechecked_each_call(self):
        intent=self.prepare()
        self.host_file.write_text(json.dumps({**HOST,"max_duration_ms":14999}))
        self.host_file.chmod(0o600)
        with self.assertRaisesRegex(ExecutionDenied,"stale"):
            self.dispatch({"op":"approve","plan":self.plan,
                           "envelope":self.sign(intent)})
        self.assertFalse((self.workspace/"protocolia-sandbox.sqlite3").exists())
    def test_invalid_config_permissions_prevent_new_grant(self):
        self.config_file.chmod(0o644)
        with self.assertRaises(ExecutionDenied):self.prepare()
        self.assertFalse((self.workspace/"protocolia-sandbox.sqlite3").exists())
    def test_signed_approval_and_run_with_fake_isolation(self):
        intent=self.prepare()
        envelope=self.sign(intent)
        self.dispatch({"op":"approve","plan":self.plan,"envelope":envelope})
        calls=[]
        def fake(argv,**kwargs):
            calls.append(argv)
            self.assertEqual(argv[argv.index("--network")+1],"none")
            self.assertIn("--read-only",argv)
            class Result:
                returncode=0
                stdout=json.dumps({"sha256":hashlib.sha256(b"abc").hexdigest(),"bytes":3})
            return Result()
        message={"op":"execute","plan":self.plan,"envelope":envelope}
        one=self.dispatch(message,runner=fake)
        two=self.dispatch(message,runner=fake)
        self.assertEqual(one["status"],"executed")
        self.assertEqual(two["status"],"replayed")
        self.assertEqual(len(calls),1)
        self.assertTrue(one["outputs"]["verify"])
    def test_live_unix_socket_peer_checks_and_malformed_json(self):
        with ApprovalServer(self.config_file) as server:
            thread=threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            try:
                addr=self.workspace/SOCK_NAME
                self.assertTrue(addr.is_socket())
                self.assertEqual(addr.stat().st_mode & 0o777,0o600)
                response=client(addr,{"op":"preview","plan":self.plan})
                self.assertEqual(response["status"],"preview-only")
                self.assertEqual(client(addr,{"op":"prepare","plan":self.plan,
                                              "subject":"tester","key_id":"device1"})["status"],
                                 "signature-required")
                with self.assertRaisesRegex(ExecutionDenied,"denied"):
                    client(addr,{"op":"approve","plan":self.plan,
                                 "envelope":{"intent":{},"signature_b64":"fake"}})
                raw=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
                try:
                    raw.connect(str(addr))
                    raw.sendall(b'{"op":"preview","op":"approve"}\n')
                    self.assertFalse(json.loads(raw.recv(2048))["ok"])
                finally:
                    raw.close()
            finally:
                server.shutdown()
                thread.join(timeout=4)
        self.assertFalse((self.workspace/SOCK_NAME).exists())
    def test_only_approved_peer_uid_can_connect_by_config(self):
        self.config["allowed_uids"]=[os.geteuid()+1]
        self.save_config()
        with ApprovalServer(self.config_file) as server:
            t=threading.Thread(target=server.serve_forever,daemon=True)
            t.start()
            try:
                with self.assertRaises(ExecutionDenied):
                    client(self.workspace/SOCK_NAME,{"op":"preview","plan":self.plan})
            finally:
                server.shutdown()
                t.join(timeout=4)
