"""Independently validate generated OAS output using openapi-spec-validator.

Requires the explicitly CI-installed *test-only* dependency openapi-spec-validator.
The compiler and its CLI do not import or require this dependency.
"""
import json
import sys
from pathlib import Path

from openapi_spec_validator import validate_spec


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) == 2 else Path("generated/openapi.json")
    spec = json.loads(source.read_text(encoding="utf-8"))
    if spec.get("openapi") != "3.1.0":
        raise SystemExit("expected OpenAPI 3.1.0")
    validate_spec(spec)
    print(f"EXTERNALLY VALIDATED {source}")


if __name__ == "__main__":
    main()
