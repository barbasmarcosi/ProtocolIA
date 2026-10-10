"""P3-B2.2 live Docker: signed operator key, protected gateway secret, revoke."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import secrets
import tempfile
import time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from protocolia.action_runtime import _json, ExecutionDenied
from protocolia.operator_auth import (
    CONTEXT, create_intent, approve_signed, run_signed, revoke_signed,
)

ROOT=Path(__file__).resolve().parents[1]
PLAN=json.loads((ROOT/"examples/broker-plan-v0.5.json").read_text())
HOST=json.loads((ROOT/"examples/broker-host-policy-v0.5.json").read_text())
DOCKER=json.loads((ROOT/"examples/broker-docker-policy-v0.5.json").read_text())
DOCKER["container_image"]=os.environ["P3B2_IMAGE_ID"]

def denied(call, expected):
    try: call()
    except ExecutionDenied as e:
        assert expected in str(e),(expected,str(e))
    else: raise AssertionError("FAIL OPEN "+expected)

with tempfile.TemporaryDirectory(prefix="p3-auth-docker-") as folder:
    base=Path(folder)
    inputs=base/"inputs"
    (inputs/"warehouse").mkdir(parents=True)
    (inputs/"warehouse"/"stock").write_bytes(b"abc")
    ledger=base/"ledger"
    ledger.mkdir()
    # Ephemeral operator identity in CI only: private key never enters gateway.
    operator=Ed25519PrivateKey.generate()
    other=Ed25519PrivateKey.generate()
    pub=operator.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
    registry={"version":"0.6","operators":{"ci-operator":{
        "enabled":True,"resources":["warehouse/stock"],"keys":{
            "hardware1":{"ed25519_public_b64":base64.b64encode(pub).decode(),
                         "revoked":False}}}}}
    registry_file=base/"trusted-operator-registry"
    registry_file.write_text(json.dumps(registry))
    registry_file.chmod(0o600)
    secret_file=base/"trusted-hmac-secret"
    secret_file.write_bytes(secrets.token_bytes(32))
    secret_file.chmod(0o600)
    now=int(time.time())
    intent=create_intent(PLAN,HOST,DOCKER,inputs,registry_file,
                         subject="ci-operator",key_id="hardware1",
                         environment="ci-sandbox-host",
                         issued_at=now,expires_at=now+180,
                         nonce=secrets.token_hex(16))
    signature=operator.sign(CONTEXT+_json(intent).encode())
    envelope={"intent":intent,"signature_b64":base64.b64encode(signature).decode()}
    opts={"registry_file":registry_file,"service_key_file":secret_file,
          "host_environment":"ci-sandbox-host"}
    denied(lambda:run_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts),"approval ledger")
    forged={"intent":intent,"signature_b64":base64.b64encode(
        other.sign(CONTEXT+_json(intent).encode())).decode()}
    denied(lambda:approve_signed(forged,PLAN,HOST,DOCKER,inputs,ledger,**opts),"signature")
    assert not list(ledger.iterdir()),"forged auth must not create a journal"
    approved=approve_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts)
    assert approved["subject"]=="ci-operator"
    first=run_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts)
    again=run_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts)
    assert first["status"]=="executed" and again["status"]=="replayed",(first,again)
    assert first["outputs"]["verify"] is True
    assert first["operator_approval_sha256"]==again["operator_approval_sha256"]
    import sqlite3
    with sqlite3.connect(ledger/"protocolia-sandbox.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]==1
        assert db.execute("SELECT COUNT(*) FROM operator_receipts").fetchone()[0]==1
    altered=copy.deepcopy(PLAN)
    altered["actions"][1]["args"]["value"]="other-expected"
    denied(lambda:run_signed(envelope,altered,HOST,DOCKER,inputs,ledger,**opts),"stale")
    denied(lambda:revoke_signed(forged,PLAN,HOST,DOCKER,inputs,ledger,**opts),"signature")
    assert run_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts)["status"]=="replayed"
    revoke_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts)
    denied(lambda:run_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts),"revoked")
    registry["operators"]["ci-operator"]["keys"]["hardware1"]["revoked"]=True
    registry_file.write_text(json.dumps(registry))
    registry_file.chmod(0o600)
    denied(lambda:run_signed(envelope,PLAN,HOST,DOCKER,inputs,ledger,**opts),"revoked")
print("OPERATOR ED25519 + REAL DOCKER: PASS signature auth, exact scoped approval, "
      "revocation, immutable plan, journal and replay.")
