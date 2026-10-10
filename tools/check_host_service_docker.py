"""Out-of-process Unix approval server, offline operator signer and actual Docker."""
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time

from protocolia.action_runtime import ExecutionDenied
from protocolia.operator_service import client, SOCK_NAME
from protocolia.operator_signer import generate_private_key

ROOT=Path(__file__).resolve().parents[1]
PLAN=json.loads((ROOT/"examples/broker-plan-v0.5.json").read_text())
HOST=json.loads((ROOT/"examples/broker-host-policy-v0.5.json").read_text())
DOCKER=json.loads((ROOT/"examples/broker-docker-policy-v0.5.json").read_text())
DOCKER["container_image"]=os.environ["P3_SVC_DOCKER_ID"]

def denied(call):
    try:call()
    except (ExecutionDenied,OSError):return
    raise AssertionError("FAIL OPEN: unapproved host RPC")

with tempfile.TemporaryDirectory(prefix="p3-private-daemon-") as tmp:
    root=Path(tmp)
    inputs=root/"inputs"
    (inputs/"warehouse").mkdir(parents=True)
    (inputs/"warehouse"/"stock").write_bytes(b"abc")
    ledger=root/"ledger"
    ledger.mkdir(mode=0o700)
    keydir=root/"operator"
    keydir.mkdir(mode=0o700)
    private=keydir/"operator.ed25519"
    public=generate_private_key(private)
    registry={"version":"0.6","operators":{"alice":{
        "enabled":True,"resources":["warehouse/stock"],"keys":{
            "device1":{"ed25519_public_b64":public,"revoked":False}}}}}
    files={
        "registry":registry, "host":HOST, "docker":DOCKER,
        "secret":secrets.token_bytes(32)}
    paths={}
    for name,value in files.items():
        path=root/(name+".private")
        path.write_bytes(value if isinstance(value,bytes) else json.dumps(value).encode())
        path.chmod(0o600)
        paths[name]=path
    config={
        "version":"0.6","inputs":str(inputs),"workspace":str(ledger),
        "registry_file":str(paths["registry"]),"service_key_file":str(paths["secret"]),
        "host_policy_file":str(paths["host"]),"docker_policy_file":str(paths["docker"]),
        "environment":"ci-host","allowed_uids":[os.geteuid()]}
    conf=root/"private-config.json"
    conf.write_text(json.dumps(config))
    conf.chmod(0o600)
    process=subprocess.Popen(
        [sys.executable,"-m","protocolia.operator_service","--config",str(conf)],
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    sock=ledger/SOCK_NAME
    try:
        for i in range(140):
            if sock.is_socket():break
            if process.poll() is not None:raise AssertionError(process.stderr.read())
            time.sleep(.05)
        else:raise AssertionError("Unix host daemon did not start")
        assert sock.stat().st_mode & 0o777==0o600
        assert client(sock,{"op":"preview","plan":PLAN})["status"]=="preview-only"
        intent=client(sock,{"op":"prepare","plan":PLAN,
                            "subject":"alice","key_id":"device1"})["intent"]
        assert not (ledger/"protocolia-sandbox.sqlite3").exists()
        intentfile=root/"operator-intent.json"
        intentfile.write_text(json.dumps(intent))
        signer=subprocess.run([
            sys.executable,"-m","protocolia.operator_signer","sign",
            "--private-key",str(private),"--intent",str(intentfile),
            "--confirm-plan-sha256",intent["plan_sha256"],
            "--confirm-resource",intent["resource"]],
            capture_output=True,text=True,check=True)
        envelope=json.loads(signer.stdout)
        denied(lambda:client(sock,{"op":"approve","plan":PLAN,"envelope":envelope,
                                   "service_key_file":"/tmp/evil"}))
        fake={"intent":intent,"signature_b64":base64.b64encode(secrets.token_bytes(64)).decode()}
        denied(lambda:client(sock,{"op":"approve","plan":PLAN,"envelope":fake}))
        approval=client(sock,{"op":"approve","plan":PLAN,"envelope":envelope})
        assert approval["status"]=="approved-operator"
        first=client(sock,{"op":"execute","plan":PLAN,"envelope":envelope},timeout=30)
        replay=client(sock,{"op":"execute","plan":PLAN,"envelope":envelope},timeout=30)
        assert first["status"]=="executed" and replay["status"]=="replayed"
        assert first["outputs"]["verify"] is True and first["operator"]=="alice"
        registry["operators"]["alice"]["keys"]["device1"]["revoked"]=True
        paths["registry"].write_text(json.dumps(registry))
        paths["registry"].chmod(0o600)
        denied(lambda:client(sock,{"op":"execute","plan":PLAN,"envelope":envelope}))
        print("LIVE UNIX HOST+DOCKER PASS: offline signing, isolation, read-only execution, replay, revoked key")
    finally:
        process.terminate()
        try:process.communicate(timeout=8)
        except subprocess.TimeoutExpired:process.kill();process.communicate()
