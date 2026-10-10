"""Offline operator private keys never enter the trusted host approval gateway."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import base64

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from protocolia.action_runtime import ExecutionDenied, _json
from protocolia.operator_auth import CONTEXT
from protocolia.operator_signer import generate_private_key, sign_for_operator

class OperatorSignerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.keyfile=self.root/"private.ed25519"
        self.public=generate_private_key(self.keyfile)
        self.intent={
            "version":"0.6","subject":"human1","key_id":"laptop1",
            "environment":"signed-host","request_id":"b"+"a"*40,
            "request_hash":"a"*64,"tool":"file.sha256","resource":"warehouse/stock",
            "container_image":"sha256:"+"a"*64,
            "plan_sha256":"b"*64,"host_policy_sha256":"c"*64,
            "docker_policy_sha256":"d"*64,"input_sha256":"e"*64,
            "tool_fingerprint":"f"*64,"registry_sha256":"a"*64,
            "issued_at":100,"expires_at":200,"nonce":"f"*32
        }
    def test_valid_offline_signature(self):
        result=sign_for_operator(self.intent,self.keyfile,
               confirmed_plan="b"*64,confirmed_resource="warehouse/stock")
        Ed25519PublicKey.from_public_bytes(base64.b64decode(self.public)).verify(
            base64.b64decode(result["signature_b64"]),
            CONTEXT+_json(result["intent"]).encode())
        self.assertEqual(self.keyfile.stat().st_mode & 0o777,0o600)
    def test_wrong_plan_or_resource_cannot_be_signed(self):
        for plan,resource in (("0"*64,"warehouse/stock"),("b"*64,"other/resource")):
            with self.subTest(plan=plan,resource=resource),self.assertRaisesRegex(ExecutionDenied,"confirm"):
                sign_for_operator(self.intent,self.keyfile,confirmed_plan=plan,
                                  confirmed_resource=resource)
    def test_private_key_permissions_and_existing_key(self):
        with self.assertRaisesRegex(ExecutionDenied,"exists"):
            generate_private_key(self.keyfile)
        self.keyfile.chmod(0o644)
        with self.assertRaisesRegex(ExecutionDenied,"private"):
            sign_for_operator(self.intent,self.keyfile,
                confirmed_plan="b"*64,confirmed_resource="warehouse/stock")
    def test_cli_never_outputs_private_bytes_and_rejects_false_review(self):
        intentfile=self.root/"intent.json"
        intentfile.write_text(json.dumps(self.intent))
        cmd=[sys.executable,"-m","protocolia.operator_signer","sign",
             "--private-key",str(self.keyfile),"--intent",str(intentfile),
             "--confirm-plan-sha256","b"*64,"--confirm-resource","warehouse/stock"]
        allowed=subprocess.run(cmd,capture_output=True,text=True,check=True)
        env=json.loads(allowed.stdout)
        self.assertIn("signature_b64",env)
        self.assertNotIn("private",allowed.stdout)
        cmd[-1]="warehouse/other"
        denied=subprocess.run(cmd,capture_output=True,text=True)
        self.assertEqual(denied.returncode,1)
        self.assertIn("confirm",denied.stderr)
