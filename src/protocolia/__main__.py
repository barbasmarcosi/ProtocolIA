"""python -m protocolia {validate|compile} contract.json [--out DIR]."""
import argparse
import json
import sys
from pathlib import Path

from .core import ContractError, compile_contract, validate, write_artifacts


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """JSON duplicate keys are ambiguous; do not silently take the last value."""
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError(f"duplicate JSON member: {key}")
        result[key] = value
    return result


def main() -> int:
    parser = argparse.ArgumentParser(prog="protocolia")
    parser.add_argument("command", choices=["validate", "compile"])
    parser.add_argument("contract", type=Path)
    parser.add_argument("--out", type=Path, default=Path("generated"))
    args = parser.parse_args()
    try:
        contract = json.loads(args.contract.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
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
