"""python -m protocolia {validate|compile} contract.json [--out DIR]."""
import argparse
import json
import sys
from pathlib import Path

from .core import ContractError, compile_contract, validate, write_artifacts


def main() -> int:
    parser = argparse.ArgumentParser(prog="protocolia")
    parser.add_argument("command", choices=["validate", "compile"])
    parser.add_argument("contract", type=Path)
    parser.add_argument("--out", type=Path, default=Path("generated"))
    args = parser.parse_args()
    try:
        contract = json.loads(args.contract.read_text(encoding="utf-8"))
        if args.command == "validate":
            validated = validate(contract)
            print(f"VALID {validated['namespace']} ({len(validated['operations'])} operations)")
        else:
            artifacts = compile_contract(contract)
            write_artifacts(artifacts, args.out)
            print(f"GENERATED {len(artifacts)} artifacts in {args.out}")
    except (ContractError, OSError, ValueError) as exc:
        print(f"protocolia: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
