"""P3-B2 live Docker integration; only disposable CI local files/permissions."""
import copy
import hashlib
import json
import os
from pathlib import Path
import secrets
import tempfile

from protocolia.action_broker import (
    ExecutionDenied, approve_plan, preview_plan, run_plan,
)
from protocolia.sandbox_adapter import revoke

ROOT=Path(__file__).resolve().parents[1]
PLAN=json.loads((ROOT/"examples/broker-plan-v0.5.json").read_text())
HOST=json.loads((ROOT/"examples/broker-host-policy-v0.5.json").read_text())
SANDBOX=json.loads((ROOT/"examples/broker-docker-policy-v0.5.json").read_text())
SANDBOX["container_image"]=os.environ["P3B2_IMAGE_ID"]
SECRET=secrets.token_bytes(32)

def denied(call, expected):
    try:call()
    except ExecutionDenied as e:
        assert expected in str(e),(expected,str(e))
    else:raise AssertionError("FAIL OPEN: expected "+expected)

with tempfile.TemporaryDirectory(prefix="protocolia-broker-ci-") as tmp:
    root=Path(tmp)
    source=root/"inputs"
    (source/"warehouse").mkdir(parents=True)
    (source/"warehouse"/"stock").write_bytes(b"abc")
    ledger=root/"ledger"
    ledger.mkdir()
    identity={"subject":"host-fixture-operator","environment":"isolated-ci",
              "secret":SECRET}
    options={**identity,"now":lambda:100.0}
    p=preview_plan(PLAN,HOST,SANDBOX,source)
    assert p["order"]==["expected","read","verify"],p
    assert p["external_snapshot"]["input_sha256"]==hashlib.sha256(b"abc").hexdigest()
    assert p["external_timeout_ms"]==10000
    assert not list(ledger.iterdir()),"preview has side effects"
    denied(lambda:run_plan(PLAN,HOST,SANDBOX,source,ledger,**options),"approval ledger")
    approved=approve_plan(PLAN,HOST,SANDBOX,source,ledger,**options)
    first=run_plan(PLAN,HOST,SANDBOX,source,ledger,**options)
    second=run_plan(PLAN,HOST,SANDBOX,source,ledger,**options)
    assert first["status"]=="executed" and second["status"]=="replayed",(first,second)
    assert first["outputs"]["verify"] is True
    assert first["external_evidence"]["input_sha256"]==p["external_snapshot"]["input_sha256"]
    assert first["external_evidence"]["request_id"]==approved["external_request_id"]
    mutated=copy.deepcopy(PLAN)
    mutated["actions"][1]["args"]["value"]="different"
    new=preview_plan(mutated,HOST,SANDBOX,source)
    assert new["external_request"]["request_id"]!=approved["external_request_id"]
    denied(lambda:run_plan(mutated,HOST,SANDBOX,source,ledger,**options),"approval")
    changed=copy.deepcopy(HOST)
    changed["max_duration_ms"]=14999
    denied(lambda:run_plan(PLAN,changed,SANDBOX,source,ledger,**options),"approval")
    bad=copy.deepcopy(HOST)
    bad["grants"]["file.sha256"]=[]
    denied(lambda:preview_plan(PLAN,bad,SANDBOX,source),"resource denied")
    (source/"warehouse"/"stock").write_bytes(b"changed")
    denied(lambda:run_plan(PLAN,HOST,SANDBOX,source,ledger,**options),"stale")
    (source/"warehouse"/"stock").write_bytes(b"abc")
    denied(lambda:revoke(approved["external_request_id"],ledger,
                         secret=b"different-32-byte-host-approval-key"),"revocation secret")
    assert run_plan(PLAN,HOST,SANDBOX,source,ledger,**options)["status"]=="replayed"
    revoke(approved["external_request_id"],ledger,secret=SECRET)
    denied(lambda:run_plan(PLAN,HOST,SANDBOX,source,ledger,**options),"revoked")
    print("BROKER REAL DOCKER: PASS host-bound typed DAG, SHA postcondition, "
          "single attempt/replay, mutated plan/policy, revoked/wrong signer, "
          "stale input and explicit permission denials.")
