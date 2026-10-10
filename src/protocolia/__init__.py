"""ProtocolIA: contracts before code."""
from .core import ContractError, compile_contract, validate, write_artifacts
from .compatibility import compare_contracts
__all__ = ["ContractError", "compile_contract", "validate", "write_artifacts", "compare_contracts"]
