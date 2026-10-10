"""Installed CLI for ProtocolIA contracts."""
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
    parser.add_argument("command", choices=["validate", "compile", "diff", "migrate", "preview"])
    parser.add_argument("contract",type=Path)
    parser.add_argument("candidate",type=Path,nargs="?")
    parser.add_argument("--out",type=Path,default=Path("generated"))
    args=parser.parse_args()
    if args.command=="diff" and args.candidate is None:
        parser.error("diff requires old and candidate contract paths")
    if args.command!="diff" and args.candidate is not None:
        parser.error("unexpected candidate path")
    try:
        contract=json.loads(args.contract.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
        if args.command=="validate":
            normalized=validate(contract)
            print(f"VALID {normalized['namespace']} ({len(normalized['operations'])} operations)")
        elif args.command=="diff":
            candidate=json.loads(args.candidate.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
            report=compare_contracts(contract,candidate)
            print(json.dumps(report,indent=2,sort_keys=True))
            return 2 if not report['compatible'] else 0
        elif args.command=="preview":
            artifacts=compile_contract(contract)
            print(json.dumps(preview_artifacts(artifacts,args.out),sort_keys=True,indent=2))
        elif args.command=="migrate":
            migrated=migrate_contract(contract)
            print(json.dumps(migrated,sort_keys=True,indent=2,ensure_ascii=False))
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
