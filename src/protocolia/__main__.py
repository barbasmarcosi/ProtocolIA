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
    parser.add_argument("command", choices=["validate","compile","diff","migrate","preview","generate-java","generate-inventory-java","init-java","compile-http","compile-bundle","diff-bundle","action-preview","action-run"])
    parser.add_argument("contract",type=Path)
    parser.add_argument("candidate",type=Path,nargs="?")
    parser.add_argument("--out",type=Path,default=Path("generated"))
    parser.add_argument("--policy",type=Path)
    parser.add_argument("--environment",type=str)
    parser.add_argument("--profile",choices=["java-spring-basic-demo"])
    parser.add_argument("--domain-errors",type=Path)
    parser.add_argument("--resources",type=Path)
    parser.add_argument("--candidate-resources",type=Path)
    args=parser.parse_args()
    if args.command in {"compile-http", "compile-bundle"} and args.profile!="java-spring-basic-demo":
        parser.error("target compilation requires --profile java-spring-basic-demo")
    if args.command not in {"compile-http", "compile-bundle"} and (args.profile is not None or args.domain_errors is not None):
        parser.error("--profile/--domain-errors reserved for target compilation")
    if args.command in {"compile-bundle", "diff-bundle"} and args.resources is None:
        parser.error("resource bundle commands require --resources")
    if args.command=="diff-bundle" and args.candidate_resources is None:
        parser.error("diff-bundle requires --candidate-resources")
    if args.command not in {"compile-bundle", "diff-bundle"} and args.resources is not None:
        parser.error("--resources reserved for bundle commands")
    if args.command!="diff-bundle" and args.candidate_resources is not None:
        parser.error("--candidate-resources reserved for diff-bundle")
    if args.command in {"diff", "diff-bundle"} and args.candidate is None:
        parser.error("diff requires old and candidate contract paths")
    if args.command not in {"diff", "diff-bundle"} and args.candidate is not None:
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
        elif args.command=="diff-bundle":
            from .resource_bundle import compare_resource_bundles
            candidate=json.loads(args.candidate.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
            original_resources=json.loads(args.resources.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
            next_resources=json.loads(args.candidate_resources.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
            report=compare_resource_bundles(contract,original_resources,candidate,next_resources)
            print(json.dumps(report,sort_keys=True,indent=2))
            return 2 if not report["compatible"] else 0
        elif args.command=="preview":
            print(json.dumps(preview_artifacts(compile_contract(contract),args.out),sort_keys=True,indent=2))
        elif args.command=="migrate":
            print(json.dumps(migrate_contract(contract),sort_keys=True,indent=2,ensure_ascii=False))
        elif args.command=="init-java":
            from .java_project import init_java
            created, total = init_java(contract,args.out)
            print(f"READY Java Spring project ({total} generated files) in {args.out}")
            if created:
                print("EDIT src/main/java/dev/protocolia/generated/custom/StarterHandlers.java (user-owned; initial methods return 501)")
            else:
                print("KEPT user-owned StarterHandlers.java unchanged; adapt it to the current ContractHandlers interface if needed")
            print(f"NEXT cd {args.out} && mvn -B -ntp clean verify")
        elif args.command=="compile-http":
            from .http_projection import compile_java_http
            errors=(json.loads(args.domain_errors.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
                    if args.domain_errors is not None else None)
            artifacts=compile_java_http(contract,errors)
            write_artifacts(artifacts,args.out)
            print(f"GENERATED Java Basic demo HTTP profile ({len(artifacts)} artifacts) in {args.out}")
        elif args.command=="compile-bundle":
            from .resource_bundle import compile_resource_bundle
            description=json.loads(args.resources.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
            errors=(json.loads(args.domain_errors.read_text(encoding="utf-8"),object_pairs_hook=_reject_duplicate_keys)
                    if args.domain_errors is not None else None)
            artifacts=compile_resource_bundle(contract,description,errors)
            write_artifacts(artifacts,args.out)
            print(f"GENERATED validated Java resource bundle ({len(artifacts)} artifacts) in {args.out}")
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
