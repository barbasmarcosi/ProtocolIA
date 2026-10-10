"""Trusted-host CLI for P3-B1, never callable as a model-selected action.

Approval secret is host environment only, not part of request/policy artifacts.
"""
import argparse
import json
import os
from pathlib import Path
import sys
from .action_runtime import ExecutionDenied
from .sandbox_adapter import approve, preview, revoke, run

def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ExecutionDenied("duplicate JSON key in host/request document")
        result[key]=value
    return result

def main()->int:
    parser=argparse.ArgumentParser(prog="protocolia-sandbox")
    parser.add_argument("command",choices=("preview","approve","run","revoke"))
    parser.add_argument("--request",type=Path)
    parser.add_argument("--policy",type=Path)
    parser.add_argument("--inputs",type=Path)
    parser.add_argument("--workspace",type=Path)
    parser.add_argument("--subject")
    parser.add_argument("--environment")
    parser.add_argument("--ttl",type=int,default=300)
    parser.add_argument("--request-id")
    args=parser.parse_args()
    try:
        if args.command!="revoke" and not all((args.request,args.policy,args.inputs)):
            parser.error("request, policy and inputs are mandatory")
        if args.command in ("approve","run") and not all((args.workspace,args.subject,args.environment)):
            parser.error("approval/execution require trusted workspace, subject and environment")
        if args.command=="revoke" and not all((args.workspace,args.request_id)):
            parser.error("revocation requires workspace and request-id")
        secret=os.environ.get("PROTOCOLIA_SANDBOX_APPROVAL_SECRET","").encode("utf-8")
        if args.command=="revoke":
            revoke(args.request_id,args.workspace,secret=secret)
            print(json.dumps({"revoked":args.request_id},sort_keys=True))
            return 0
        request=json.loads(args.request.read_text(encoding="utf-8"),object_pairs_hook=_unique)
        policy=json.loads(args.policy.read_text(encoding="utf-8"),object_pairs_hook=_unique)
        if args.command=="preview":
            result=preview(request,policy,args.inputs)
        elif args.command=="approve":
            result=approve(request,policy,args.inputs,args.workspace,subject=args.subject,
                           environment=args.environment,secret=secret,ttl=args.ttl)
        else:
            result=run(request,policy,args.inputs,args.workspace,subject=args.subject,
                       environment=args.environment,secret=secret)
        print(json.dumps(result,sort_keys=True,indent=2))
    except (ExecutionDenied,OSError,ValueError) as error:
        print("protocolia-sandbox: "+str(error),file=sys.stderr)
        return 1
    return 0

if __name__=="__main__":
    raise SystemExit(main())
