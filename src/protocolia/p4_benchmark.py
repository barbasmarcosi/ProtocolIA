"""P4 experimental study harness for already-authenticated Codex / Claude Code CLI.

Provider-free: no API, keys, SDK, payment or automatic model invocation. The
user runs CLI sessions in isolated worktrees and imports counters & independent
verifier results. Unknown subscription costs remain UNKNOWN, not zero.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

ARMS=("direct","conventional","protocolia")
ENGINES=("codex","claude")
ID=re.compile(r"^[a-z][a-z0-9-]{1,63}$")
HEX=re.compile(r"^[a-f0-9]{64}$")

class BenchmarkError(ValueError):pass
def deny(s):raise BenchmarkError(s)
def pairs(xs):
    out={}
    for k,v in xs:
        if k in out:deny("duplicate JSON field")
        out[k]=v
    return out
def canonical(x):
    return (json.dumps(x,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False)+"\n").encode()
def digest(x):return hashlib.sha256(canonical(x)).hexdigest()
def read(path:Path):
    if not path.is_file() or path.is_symlink() or path.stat().st_size>2000000:
        deny("missing/untrusted/oversize JSON file")
    def reject(c):deny("non-finite JSON")
    try:return json.loads(path.read_text("utf-8"),object_pairs_hook=pairs,parse_constant=reject)
    except (ValueError,UnicodeError,RecursionError) as e:deny("invalid JSON: "+type(e).__name__)
def exact(x,fields,label):
    if type(x) is not dict or set(x)!=set(fields):deny("unexpected "+label+" fields")
    return x
def ident(x,label):
    if type(x) is not str or not ID.fullmatch(x):deny("invalid "+label)
    return x

def check(spec):
    exact(spec,["version","study","rounds","engines","arms","tasks",
                "budget","verification","analysis","tools"],"study")
    if spec["version"]!="p4-1":deny("unsupported study version")
    ident(spec["study"],"study")
    if type(spec["rounds"]) is not int or not 3<=spec["rounds"]<=20:deny("repeat count must be 3-20")
    if spec["arms"]!=list(ARMS):deny("all three arms mandatory")
    if (type(spec["engines"]) is not list or not spec["engines"] or
        len(spec["engines"])!=len(set(spec["engines"])) or
        any(e not in ENGINES for e in spec["engines"])):deny("unsupported CLI engine")
    tasks=spec["tasks"]
    if type(tasks) is not list or not 3<=len(tasks)<=32:deny("at least three held-out tasks required")
    ids=set();strata=set()
    for task in tasks:
        exact(task,["id","stratum","spec_sha256","source_repo","source_commit","description"],"task")
        ident(task["id"],"task");ident(task["stratum"],"task stratum")
        if task["id"] in ids:deny("duplicate task")
        ids.add(task["id"]);strata.add(task["stratum"])
        if (type(task["spec_sha256"]) is not str or not HEX.fullmatch(task["spec_sha256"])
            or type(task["description"]) is not str or len(task["description"])<12):
            deny("unfrozen or undescribed task")
        for key in ("source_repo","source_commit"):
            if type(task[key]) is not str or not task[key].strip():deny("unpinned task origin")
    if len(strata)<3:deny("at least 3 strata required")
    budget=exact(spec["budget"],["max_seconds","max_interventions","max_repairs"],"budget")
    for name,bound in [("max_seconds",36000),("max_interventions",20),("max_repairs",20)]:
        v=budget[name]
        if type(v) is not int or not 0<=v<=bound:deny("invalid trial budget")
    if budget["max_seconds"]<60:deny("trial must have a realistic time budget")
    verify=exact(spec["verification"],["repo","commit","contract"],"verifier")
    if any(type(x) is not str or not x.strip() for x in verify.values()):
        deny("missing independently pinned verifier")
    analysis=exact(spec["analysis"],["primary","secondary","decision"],"analysis")
    if (analysis["primary"]!="verified_success_rate" or
        analysis["secondary"]!=["wall_seconds_per_verified_success","observed_cli_tokens"] or
        "no winner" not in analysis["decision"].lower()):
        deny("preregistration must keep success and incomplete no-winner rules")
    tools=exact(spec["tools"],["protocolia_commit","conventional_generator"],"source freeze")
    if any(type(x) is not str or not x.strip() for x in tools.values()):
        deny("unfrozen generator versions")
    return spec

def assignments(spec):
    check(spec)
    jobs=[]
    for engine in spec["engines"]:
        for task in spec["tasks"]:
            for repetition in range(1,spec["rounds"]+1):
                order=sorted(ARMS,key=lambda arm:hashlib.sha256(
                    f"{spec['study']}|{engine}|{task['id']}|{repetition}|{arm}".encode()).hexdigest())
                for pos,arm in enumerate(order,1):
                    jobs.append({"run_id":f"{engine}-{task['id']}-r{repetition:02}-{arm}",
                                 "engine":engine,"arm":arm,"task_id":task["id"],
                                 "stratum":task["stratum"],"repeat":repetition,
                                 "order":pos,"study_sha256":digest(spec)})
    return jobs

def lock(spec):
    check(spec)
    return {"version":"p4-lock-1","protocol":spec,
            "protocol_sha256":digest(spec),"assignments":assignments(spec)}
def load(path):
    x=read(path)
    exact(x,["version","protocol","protocol_sha256","assignments"],"study lock")
    if (x["version"]!="p4-lock-1" or
        digest(check(x["protocol"]))!=x["protocol_sha256"] or
        assignments(x["protocol"])!=x["assignments"]):
        deny("study lock altered after preregistration")
    return x
def create(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink():deny("symlink output denied")
    try:
        with path.open("xb") as f:f.write(canonical(obj))
    except FileExistsError:deny("overwrite of frozen evidence denied")

def packet(frozen,run_id):
    entry=next((j for j in frozen["assignments"] if j["run_id"]==run_id),None)
    if not entry:deny("run not preregistered")
    task=next(t for t in frozen["protocol"]["tasks"] if t["id"]==entry["task_id"])
    advice={
        "direct":"Implement directly. Neither OpenAPI Generator nor ProtocolIA may be used.",
        "conventional":"Use the pinned conventional generator/templates if applicable, never ProtocolIA.",
        "protocolia":"Use the pinned ProtocolIA generator where applicable; record unsupported contracts and implement business logic yourself. Generic HTTP 501 placeholders do not count."
    }[entry["arm"]]
    return {"assignment":entry,"task":task,"prompt":
        "Implement the exact pinned task in a NEW clean isolated worktree. "
        "Use an already-authenticated Codex or Claude Code subscription CLI; no API keys or provider SDKs. "
        "Identical requirements, limited repairs and independent black-box verification across all arms. "
        "Do not inspect the verifier source, alter task contracts or share worktrees between trials. "
        +advice}

def _usage(obj,names):
    if type(obj) is not dict:return {k:None for k in names}
    return {k:(obj[k] if type(obj.get(k)) is int and obj[k]>=0 else None) for k in names}

def trace_summary(text,engine):
    if engine not in ENGINES:deny("bad CLI")
    if len(text.encode())>10000000:deny("excessive CLI trace")
    events=[]
    # One Claude --output-format json object may be pretty-printed.
    try:
        whole=json.loads(text,object_pairs_hook=pairs)
        if type(whole) is dict:events=[whole]
    except (ValueError,TypeError):pass
    if not events:
        for line in text.splitlines():
            if not line.strip():continue
            try:event=json.loads(line,object_pairs_hook=pairs)
            except (ValueError,TypeError):deny("malformed CLI JSONL")
            if type(event) is not dict:deny("malformed CLI event")
            events.append(event)
    if not events:deny("empty CLI trace")
    keys=("input_tokens","output_tokens","cached_input_tokens")
    counters={k:None for k in keys}
    source="unavailable"
    api_equiv=None
    if engine=="codex":
        ends=[e for e in events if e.get("type")=="turn.completed"]
        if not ends:deny("Codex requires completed turn JSON events")
        usage=[_usage(e.get("usage"),keys) for e in ends]
        for k in keys:
            if all(v[k] is not None for v in usage):counters[k]=sum(v[k] for v in usage)
        source="codex-turn-completed"
    else:
        finals=[e for e in events if e.get("type")=="result"]
        if len(finals)!=1:deny("Claude requires exactly one final result")
        u=finals[0].get("usage")
        base=_usage(u,("input_tokens","output_tokens","cache_read_input_tokens"))
        counters={"input_tokens":base["input_tokens"],
                  "output_tokens":base["output_tokens"],
                  "cached_input_tokens":base["cache_read_input_tokens"]}
        cost=finals[0].get("total_cost_usd")
        if type(cost) in (int,float) and math.isfinite(cost) and cost>=0:
            api_equiv=cost  # NOT actually billed to the subscription
        source="claude-result"
    return {"source":source,"sha256":hashlib.sha256(text.encode()).hexdigest(),
            "observed_tokens":counters,"api_equivalent_usd_not_billed":api_equiv,
            "actual_subscription_usd":None}

def record(frozen,run_id,verification,engine_version,model,seconds,code,interventions,repairs,trace=None):
    entry=packet(frozen,run_id)["assignment"]
    exact(verification,["verifier_commit","tests_passed","security_passed",
                        "evidence_sha256","independent"],"independent verification")
    if (verification["verifier_commit"]!=frozen["protocol"]["verification"]["commit"] or
        verification["independent"] is not True or
        type(verification["tests_passed"]) is not bool or
        type(verification["security_passed"]) is not bool or
        type(verification["evidence_sha256"]) is not str or
        not HEX.fullmatch(verification["evidence_sha256"])):
        deny("missing or mismatched independent verification")
    if (type(seconds) not in (int,float) or not math.isfinite(seconds) or seconds<0 or
        type(code) is not int or type(interventions) is not int or interventions<0 or
        type(repairs) is not int or repairs<0 or
        any(type(x) is not str or not x.strip() or len(x)>200 for x in (engine_version,model))):
        deny("missing CLI or timing metadata")
    budget=frozen["protocol"]["budget"]
    over=(seconds>budget["max_seconds"] or interventions>budget["max_interventions"]
          or repairs>budget["max_repairs"])
    success=(code==0 and not over and verification["tests_passed"]
             and verification["security_passed"])
    usage=trace_summary(trace,entry["engine"]) if trace is not None else {
        "source":"manual-trace-unknown","sha256":None,
        "observed_tokens":{k:None for k in ("input_tokens","output_tokens","cached_input_tokens")},
        "api_equivalent_usd_not_billed":None,"actual_subscription_usd":None}
    return {"version":"p4-result-1","assignment":entry,"model":model,
            "cli_version":engine_version,"seconds":seconds,"exit_code":code,
            "interventions":interventions,"repairs":repairs,"over_budget":over,
            "verified_success":bool(success),"verification":verification,"usage":usage}

def _wilson(good,n):
    if not n:return None
    z=1.95996398454;p=good/n;d=1+z*z/n
    c=(p+z*z/(2*n))/d
    m=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [round(max(0,c-m),4),round(min(1,c+m),4)]
def report(frozen,results):
    index={a["run_id"]:a for a in frozen["assignments"]}
    obs={}
    for x in results:
        if type(x) is not dict or x.get("version")!="p4-result-1":
            deny("invalid recorded attempt")
        trial=x.get("assignment")
        if type(trial) is not dict or trial.get("run_id") not in index or trial!=index[trial["run_id"]]:
            deny("unregistered/altered attempt")
        key=trial["run_id"]
        if key in obs:deny("duplicate trial: cannot select the best revision")
        if x.get("verification",{}).get("verifier_commit")!=frozen["protocol"]["verification"]["commit"]:
            deny("unfrozen verifier")
        obs[key]=x
    grouped={}
    for eng in frozen["protocol"]["engines"]:
        for arm in ARMS:
            intended=[x for x in frozen["assignments"] if x["engine"]==eng and x["arm"]==arm]
            present=[obs[x["run_id"]] for x in intended if x["run_id"] in obs]
            success=sum(x.get("verified_success") is True for x in present)
            wall=sum(x["seconds"] for x in present)
            fields=("input_tokens","output_tokens","cached_input_tokens")
            tokens={k:[x["usage"]["observed_tokens"].get(k) for x in present] for k in fields}
            grouped[f"{eng}:{arm}"]={
                "scheduled":len(intended),"recorded":len(present),
                "missing":[x["run_id"] for x in intended if x["run_id"] not in obs],
                "verified_successes":success,
                "observed_success_rate":success/len(present) if present else None,
                "wilson_95":_wilson(success,len(present)),
                "wall_seconds_per_verified_success":wall/success if success else None,
                "token_totals_observable":{k:sum(v) if len(v)==len(present) and
                  len(v)>0 and all(type(y) is int for y in v) else None for k,v in tokens.items()},
                "actual_subscription_usd":None}
    completed=len(obs)==len(index)
    return {"version":"p4-report-1","study_sha256":frozen["protocol_sha256"],
            "scheduled":len(index),"recorded":len(obs),"complete":completed,
            "groups":grouped,"subscription_usd_per_success":None,
            "decision":"Requires independent review and uncertainty; no winner automatically"
                     if completed else "INCOMPLETE: no winner; every scheduled failure/missing trial retained",
            "caution":"CLI token counts may be unavailable; API-equivalent dollars are not subscription charges"}

def main(argv=None):
    parser=argparse.ArgumentParser(prog="python -m protocolia.p4_benchmark")
    sub=parser.add_subparsers(dest="action",required=True)
    p=sub.add_parser("freeze");p.add_argument("protocol",type=Path);p.add_argument("output",type=Path)
    p=sub.add_parser("packet");p.add_argument("lock",type=Path);p.add_argument("run_id")
    p=sub.add_parser("record")
    p.add_argument("lock",type=Path);p.add_argument("run_id")
    p.add_argument("verification",type=Path);p.add_argument("output",type=Path)
    p.add_argument("--engine-version",required=True);p.add_argument("--model",required=True)
    p.add_argument("--seconds",required=True,type=float);p.add_argument("--exit-code",required=True,type=int)
    p.add_argument("--interventions",required=True,type=int);p.add_argument("--repairs",required=True,type=int)
    p.add_argument("--trace",type=Path)
    p=sub.add_parser("report");p.add_argument("lock",type=Path);p.add_argument("results",type=Path)
    args=parser.parse_args(argv)
    try:
        if args.action=="freeze":
            x=lock(read(args.protocol));create(args.output,x)
            print(json.dumps({"study_sha256":x["protocol_sha256"],"scheduled":len(x["assignments"])}))
        elif args.action=="packet":
            print(json.dumps(packet(load(args.lock),args.run_id),indent=2,ensure_ascii=False))
        elif args.action=="record":
            content=args.trace.read_text("utf-8") if args.trace else None
            value=record(load(args.lock),args.run_id,read(args.verification),args.engine_version,
                         args.model,args.seconds,args.exit_code,args.interventions,args.repairs,content)
            create(args.output,value)
            print(json.dumps({"run_id":args.run_id,"verified_success":value["verified_success"]}))
        else:
            folder=args.results
            if not folder.is_dir() or folder.is_symlink():deny("results must be a private directory")
            x=report(load(args.lock),[read(f) for f in sorted(folder.glob("*.json"))])
            print(json.dumps(x,indent=2))
    except (BenchmarkError,OSError) as error:
        print("p4 benchmark: "+str(error),file=sys.stderr)
        return 2
    return 0

if __name__=="__main__":raise SystemExit(main())
