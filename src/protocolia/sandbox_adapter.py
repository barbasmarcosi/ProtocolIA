"""P3-B experimental one-tool, read-only Docker sandbox; never executes model code."""
from __future__ import annotations
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import tempfile
import time
from typing import Any
from uuid import uuid4
from .action_runtime import ExecutionDenied, _deny, _identifier, _key, _json, _digest

IMAGE=re.compile(r"^sha256:[0-9a-f]{64}$")
TOOL="file.sha256"
SCRIPT=("import hashlib,json,pathlib;"
        "b=pathlib.Path('/input').read_bytes();"
        "print(json.dumps({'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}))")


def _check(request: Any, policy: Any) -> tuple[dict,dict]:
    if type(request) is not dict or set(request)!={"version","request_id","tool","resource"}:
        _deny("invalid sandbox request shape")
    if type(policy) is not dict or set(policy)!={"version","allow","max_bytes","timeout_ms","max_spend_usd","container_image"}:
        _deny("invalid host sandbox policy shape")
    if request["version"]!="0.5" or policy["version"]!="0.5":
        _deny("unsupported sandbox protocol")
    _identifier(request["request_id"],"request id")
    if request["tool"]!=TOOL:
        _deny("tool is not allowlisted")
    _key(request["resource"])
    allow=policy["allow"]
    if type(allow) is not list or not all(type(x) is str for x in allow) or len(allow)!=len(set(allow)):
        _deny("invalid resource allowlist")
    for resource in allow:
        _key(resource)
    if request["resource"] not in allow:
        _deny("resource capability denied")
    for name,upper in (("max_bytes",1048576),("timeout_ms",15000)):
        if type(policy[name]) is not int or not 1<=policy[name]<=upper:
            _deny("unbounded or invalid sandbox budget")
    if type(policy["max_spend_usd"]) is not int or policy["max_spend_usd"]!=0:
        _deny("unknown or paid tool spending forbidden")
    if type(policy["container_image"]) is not str or not IMAGE.fullmatch(policy["container_image"]):
        _deny("host must pin a preloaded immutable image ID")
    return request,policy


def _trusted_dir(root: Path) -> None:
    if not root.is_absolute() or not root.is_dir():
        _deny("must supply existing absolute trusted directory")
    if any(x.is_symlink() for x in (root,*root.parents)):
        _deny("symlinked trusted directory")


def _bytes(root: Path, resource: str, limit: int) -> bytes:
    """Walk via dirfds and O_NOFOLLOW; never use path traversal or follow links."""
    root=Path(root)
    _trusted_dir(root)
    flags=os.O_RDONLY | getattr(os,"O_NOFOLLOW",0) | getattr(os,"O_CLOEXEC",0)
    try:
        fd=os.open(root,flags | os.O_DIRECTORY)
        try:
            parts=resource.split("/")
            for component in parts[:-1]:
                next_fd=os.open(component,flags | os.O_DIRECTORY,dir_fd=fd)
                os.close(fd)
                fd=next_fd
            target=os.open(parts[-1],flags | os.O_NONBLOCK,dir_fd=fd)
            try:
                info=os.fstat(target)
                if not stat.S_ISREG(info.st_mode) or info.st_size>limit:
                    _deny("not a bounded regular input file")
                result=bytearray()
                while len(result)<=limit:
                    chunk=os.read(target,min(65536,limit+1-len(result)))
                    if not chunk:break
                    result.extend(chunk)
                if len(result)>limit:_deny("input exceeds byte budget")
                return bytes(result)
            finally:
                os.close(target)
        finally:
            os.close(fd)
    except OSError as exc:
        _deny("input unsafe or unavailable: "+type(exc).__name__)


def preview(request: Any,policy: Any,inputs: Path)->dict:
    req,pol=_check(request,policy)
    data=_bytes(Path(inputs),req["resource"],pol["max_bytes"])
    return {"request_hash":_digest(req),"policy_hash":_digest(pol),
            "input_sha256":hashlib.sha256(data).hexdigest(),
            "input_bytes":len(data),"estimated_cost_usd":0}


def _ledger(workspace: Path, required: bool)->Path:
    workspace=Path(workspace)
    _trusted_dir(workspace)
    path=workspace/"protocolia-sandbox.sqlite3"
    if path.is_symlink() or (path.exists() and not path.is_file()):
        _deny("unsafe approval ledger path")
    if required and not path.exists():_deny("no trusted approval ledger")
    return path


def _tables(db: sqlite3.Connection)->None:
    db.execute("""CREATE TABLE IF NOT EXISTS approvals(
       request_id TEXT PRIMARY KEY, payload TEXT NOT NULL, sig TEXT NOT NULL,
       revoked INTEGER NOT NULL DEFAULT 0)""")
    db.execute("""CREATE TABLE IF NOT EXISTS attempts(
       request_id TEXT PRIMARY KEY, status TEXT NOT NULL,
       request_hash TEXT NOT NULL, input_sha TEXT NOT NULL,
       result TEXT, result_hash TEXT)""")


def _secret(value: bytes)->bytes:
    if type(value) is not bytes or len(value)<32:_deny("missing trusted 32-byte approval secret")
    return value


def approve(request: Any,policy: Any,inputs: Path,workspace: Path,*,
            subject: str,environment: str,secret: bytes,ttl: int=300,now=time.time)->dict:
    """Issuer is trusted host, NOT the model; caller must authenticate operator."""
    _secret(secret)
    _identifier(subject,"host subject")
    _identifier(environment,"environment")
    if type(ttl) is not int or not 1<=ttl<=3600:_deny("invalid approval lifetime")
    req,pol=_check(request,policy)
    snapshot=preview(req,pol,inputs)
    ticket={"request_id":req["request_id"],"request_hash":snapshot["request_hash"],
            "policy_hash":snapshot["policy_hash"],"input_sha256":snapshot["input_sha256"],
            "subject":subject,"environment":environment,"expires_at":now()+ttl,
            "nonce":uuid4().hex}
    data=_json(ticket)
    sig=hmac.new(secret,data.encode(),hashlib.sha256).hexdigest()
    with sqlite3.connect(_ledger(workspace,False),timeout=5) as db:
        _tables(db)
        try:
            db.execute("INSERT INTO approvals(request_id,payload,sig) VALUES(?,?,?)",
                       (req["request_id"],data,sig))
        except sqlite3.IntegrityError:
            _deny("approval ID reused; issue a new request")
    return {"approved":True,"request_id":req["request_id"],"expires_at":ticket["expires_at"],
            "request_hash":snapshot["request_hash"]}


def revoke(request_id: str,workspace: Path,*,secret: bytes)->None:
    _secret(secret)
    _identifier(request_id,"request id")
    with sqlite3.connect(_ledger(workspace,True),timeout=5) as db:
        _tables(db)
        if db.execute("UPDATE approvals SET revoked=1 WHERE request_id=?",(request_id,)).rowcount!=1:
            _deny("unknown approval")


def _ticket(db:sqlite3.Connection,req:dict,snapshot:dict,subject:str,environment:str,
            secret:bytes,now:float)->None:
    row=db.execute("SELECT payload,sig,revoked FROM approvals WHERE request_id=?",
                   (req["request_id"],)).fetchone()
    if row is None or row[2]:_deny("missing or revoked approval")
    if not hmac.compare_digest(row[1],hmac.new(secret,row[0].encode(),hashlib.sha256).hexdigest()):
        _deny("forged host approval signature")
    try: ticket=json.loads(row[0])
    except ValueError:_deny("invalid approval payload")
    if type(ticket) is not dict or set(ticket)!={"request_id","request_hash","policy_hash",
                        "input_sha256","subject","environment","expires_at","nonce"}:
        _deny("unknown approval fields")
    if any(ticket[k]!=snapshot[k] for k in ("request_hash","policy_hash","input_sha256")):
        _deny("stale host policy, input or request")
    if (ticket["request_id"],ticket["subject"],ticket["environment"])!=(
            req["request_id"],subject,environment):
        _deny("host approval identity mismatch")
    if type(ticket["expires_at"]) not in (int,float) or now>ticket["expires_at"]:
        _deny("host approval expired")


def _argv(image:str,stage:Path,name:str)->list[str]:
    return ["docker","run","--rm","--name",name,"--pull","never",
        "--network","none","--read-only","--cap-drop","ALL",
        "--security-opt","no-new-privileges:true","--user","65534:65534",
        "--pids-limit","32","--memory","64m","--cpus","0.5",
        "--mount",f"type=bind,source={stage},target=/input,readonly",
        "--tmpfs","/tmp:rw,nosuid,nodev,noexec,size=1m",
        image,"python3","-I","-S","-c",SCRIPT]


def run(request: Any,policy: Any,inputs: Path,workspace: Path,*,
        subject:str,environment:str,secret:bytes,runner=subprocess.run,
        now=time.time,cancelled=None)->dict:
    """Claim one durable attempt before Docker, and never retry ambiguous failures."""
    _secret(secret)
    _identifier(subject,"host subject")
    _identifier(environment,"environment")
    req,pol=_check(request,policy)
    snapshot=preview(req,pol,inputs)
    blob=_bytes(Path(inputs),req["resource"],pol["max_bytes"])
    if hashlib.sha256(blob).hexdigest()!=snapshot["input_sha256"]:
        _deny("input snapshot changed")
    if cancelled and cancelled():_deny("cancelled before execution")
    db=sqlite3.connect(_ledger(workspace,True),timeout=5,isolation_level=None)
    try:
        db.execute("BEGIN IMMEDIATE")
        _tables(db)
        _ticket(db,req,snapshot,subject,environment,secret,now())
        old=db.execute("SELECT status,request_hash,input_sha,result,result_hash FROM attempts WHERE request_id=?",
                       (req["request_id"],)).fetchone()
        if old:
            if (old[1],old[2])!=(snapshot["request_hash"],snapshot["input_sha256"]):
                _deny("stale execution binding")
            if old[0]!="completed":_deny("quarantined ambiguous attempt; no automatic retries")
            if not isinstance(old[3],str) or hashlib.sha256(old[3].encode()).hexdigest()!=old[4]:
                _deny("invalid execution evidence")
            result=json.loads(old[3])
            db.execute("COMMIT")
            return {"status":"replayed","result":result,**snapshot}
        db.execute("INSERT INTO attempts(request_id,status,request_hash,input_sha) VALUES(?,?,?,?)",
                   (req["request_id"],"started",snapshot["request_hash"],snapshot["input_sha256"]))
        db.execute("COMMIT")
        with tempfile.TemporaryDirectory(prefix="protocolia-readonly-") as tmp:
            staged=Path(tmp)/"input"
            staged.write_bytes(blob)
            staged.chmod(0o444)
            name="protocolia-"+uuid4().hex[:24]
            try:
                completed=runner(_argv(pol["container_image"],staged,name),
                                 capture_output=True,text=True,check=False,
                                 timeout=pol["timeout_ms"]/1000)
            except subprocess.TimeoutExpired:
                try:
                    subprocess.run(["docker","rm","-f",name],capture_output=True,timeout=5,check=False)
                except (OSError,subprocess.TimeoutExpired):pass
                _deny("isolated process timed out; attempt quarantined")
        if completed.returncode!=0:_deny("isolated process failed; attempt quarantined")
        if type(completed.stdout) is not str or len(completed.stdout)>4096:
            _deny("invalid or excessive tool output")
        try:result=json.loads(completed.stdout)
        except ValueError:_deny("invalid JSON tool result")
        if type(result) is not dict or result!={"sha256":snapshot["input_sha256"],"bytes":len(blob)}:
            _deny("external result did not match bounded input")
        if cancelled and cancelled():_deny("cancelled before result acceptance")
        db.execute("BEGIN IMMEDIATE")
        _ticket(db,req,snapshot,subject,environment,secret,now())
        payload=_json(result)
        db.execute("UPDATE attempts SET status='completed',result=?,result_hash=? WHERE request_id=?",
                   (payload,hashlib.sha256(payload.encode()).hexdigest(),req["request_id"]))
        db.execute("COMMIT")
        return {"status":"executed","result":result,**snapshot}
    except BaseException:
        if db.in_transaction:db.execute("ROLLBACK")
        raise
    finally:db.close()
