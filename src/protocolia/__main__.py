"""Installed CLI for ProtocolIA, including explicit Java target."""
import argparse
import json
import sys
from pathlib import Path
from .core import ContractError, compile_contract, validate, write_artifacts, preview_artifacts
from .compatibility import compare_contracts
from .v02 import migrate_contract

def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for key,value in pairs:
        if key in result:
            raise ContractError(f"duplicate JSON member: {key}")
        result[key]=value
    return result

def main() -> int:
    parser=argparse.ArgumentParser(prog="protocolia")
    parser.add_argument("command", choices=["validate","compile","diff","migrate","preview","generate-java","generate-inventory-java","action-preview","action-run"])
    parser.add_argument("contract",type=Path)
    parser.add_argument("candidate",type=Path,nargs="?")
    parser.add_argument("--out",type=Path,default=Path("generated"))
    parser.add_argument("--policy",type=Path)
    parser.add_argument("--environment",type=str)
    args=parser.parse_args()
    if args.command=="diff" and args.candidate is None:
        parser.error("diff requires old and candidate contract paths")
    if args.command!="diff" and args.candidate is not None:
        parser.error("unexpected candidate path")
    if args.command in {"action-preview","action-run"} and args.policy is None:
        parser.error("action commands require host-owned --policy")
    if args.command=="action-run" and not args.environment:
        parser.error("action-run requires --environment (trusted host identifier)")
    if args.command not in {"action-preview","action-run"} and (args.policy or args.environment):
        parser.error("--policy and --environment are reserved for action commands")
    try:
        contract=json.loads(args.contract.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
        if args.command in {"action-preview","action-run"}:
            from .action_runtime import dry_run, execute
            policy=json.loads(args.policy.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
            if args.command=="action-preview":
                result=dry_run(contract,policy)
            else:
                result=execute(contract,policy,args.out,environment=args.environment)
            print(json.dumps(result,sort_keys=True,indent=2))
        elif args.command=="validate":
            normalized=validate(contract)
            print(f"VALID {normalized['namespace']} ({len(normalized['operations'])} operations)")
        elif args.command=="diff":
            candidate=json.loads(args.candidate.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
            report=compare_contracts(contract,candidate)
            print(json.dumps(report,indent=2,sort_keys=True))
            return 2 if not report['compatible'] else 0
        elif args.command=="preview":
            print(json.dumps(preview_artifacts(compile_contract(contract),args.out),sort_keys=True,indent=2))
        elif args.command=="migrate":
            print(json.dumps(migrate_contract(contract),sort_keys=True,indent=2,ensure_ascii=False))
        elif args.command=="generate-inventory-java":
            from .inventory_backend import generate_inventory
            from .java_spring import write_java
            artifacts=generate_inventory(contract)
            write_java(artifacts,args.out)
            print(f"GENERATED inventory Spring service ({len(artifacts)} files) in {args.out}")
        elif args.command=="generate-java":
            from .java_spring import generate_java,write_java
            artifacts=generate_java(contract)
            write_java(artifacts,args.out)
            print(f"GENERATED Java Spring ({len(artifacts)} files) in {args.out}")
        else:
            artifacts=compile_contract(contract)
            write_artifacts(artifacts,args.out)
            print(f"GENERATED {len(artifacts)} artifacts in {args.out}")
    except (ContractError,OSError,ValueError) as exc:
        print(f"protocolia: {exc}",file=sys.stderr)
        return 1
    return 0
if __name__=="__main__":
    raise SystemExit(main())
