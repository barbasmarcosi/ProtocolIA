"""P3-B4: atomic provider-free budget reservation and signed-usage settlement.

NO paid vendor integration is provided. Only trusted host-issued HMAC quotes and
usage receipts may authorize amounts; a model-supplied cost is not authoritative.
Budget reservations are durable and cannot be silently released after provider
start, crash or unknown usage. Monetary values are integer micro-USD.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import time
from typing import Any, Callable

from .action_runtime import ExecutionDenied, _deny, _json, _identifier
from .operator_auth import _protected_bytes

MAX_MICROUSD = 10**12


def _amount(value: Any, *, permit_zero: bool = True) -> int:
    if type(value) is not int or not (0 if permit_zero else 1) <= value <= MAX_MICROUSD:
        _deny("unknown, negative or unbounded provider cost")
    return value


def _request_id(value: Any, name: str) -> str:
    return _identifier(value, name)


def _signed(payload: Any, signature: Any, key: bytes, fields: set[str],
            domain: str) -> dict:
    if type(payload) is not dict or set(payload) != fields:
        _deny("invalid signed " + domain + " fields")
    if type(signature) is not str or len(signature) != 64:
        _deny("missing signed " + domain)
    expected = hmac.new(key, (domain+"\x00"+_json(payload)).encode(),
                        hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        _deny("forged or stale " + domain + " signature")
    return payload


def sign_quote(quote: dict, secret: bytes) -> str:
    """Trusted metering authority only. Never put this signer into the agent."""
    return hmac.new(secret, ("protocolia-price-quote/v0.1\x00"+_json(quote)).encode(),
                    hashlib.sha256).hexdigest()


def sign_usage(usage: dict, secret: bytes) -> str:
    """Trusted vendor metering adapter only, NOT a model report."""
    return hmac.new(secret, ("protocolia-usage-proof/v0.1\x00"+_json(usage)).encode(),
                    hashlib.sha256).hexdigest()


class CostLedger:
    def __init__(self, workspace: Path, secret_file: Path,
                 now: Callable[[], float] = time.time):
        root = Path(workspace)
        if not root.is_absolute() or not root.is_dir() or root.is_symlink():
            _deny("trusted cost ledger workspace required")
        import os
        info = root.stat()
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            _deny("cost ledger workspace must be private and host-owned")
        self.path = root/"protocolia-cost.sqlite3"
        if self.path.is_symlink() or (self.path.exists() and not self.path.is_file()):
            _deny("unsafe provider cost journal")
        self.secret_file = Path(secret_file)
        self.now = now

    def _secret(self) -> bytes:
        secret = _protected_bytes(self.secret_file, max_bytes=64)
        if len(secret) != 32:
            _deny("metering authority key must be 32 bytes")
        return secret

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.execute("BEGIN IMMEDIATE")
        db.execute("""CREATE TABLE IF NOT EXISTS budgets(
          scope TEXT PRIMARY KEY, ceiling INTEGER NOT NULL CHECK(ceiling>=0))""")
        db.execute("""CREATE TABLE IF NOT EXISTS operations(
          op_id TEXT PRIMARY KEY, scope TEXT NOT NULL, provider TEXT NOT NULL,
          maximum INTEGER NOT NULL CHECK(maximum>=0), state TEXT NOT NULL,
          quote_hash TEXT NOT NULL, actual INTEGER, receipt_id TEXT UNIQUE,
          proof_hash TEXT, FOREIGN KEY(scope) REFERENCES budgets(scope))""")
        return db

    @staticmethod
    def _used(db: sqlite3.Connection, scope: str) -> int:
        value=db.execute("""SELECT COALESCE(SUM(
          CASE WHEN state='settled' THEN actual
               WHEN state='voided' THEN 0 ELSE maximum END),0)
          FROM operations WHERE scope=?""",(scope,)).fetchone()[0]
        return value

    def reserve(self, quote: Any, signature: str, *, budget_ceiling: int) -> dict:
        """Reserve BEFORE any paid operation; host owns budget ceiling."""
        key = self._secret()
        q = _signed(quote, signature, key,
            {"version","op_id","scope","provider","max_micro_usd","expires_at"},
            "protocolia-price-quote/v0.1")
        if q["version"] != "0.1":
            _deny("unsupported provider quote")
        op_id = _request_id(q["op_id"], "cost operation")
        scope = _request_id(q["scope"], "budget scope")
        _request_id(q["provider"], "provider")
        maximum = _amount(q["max_micro_usd"])
        ceiling = _amount(budget_ceiling)
        if (type(q["expires_at"]) is not int or
                not self.now() <= q["expires_at"] <= self.now()+3600):
            _deny("cost quote expired or unbounded")
        digest=hashlib.sha256(_json(q).encode()).hexdigest()
        db=self._connect()
        try:
            existing=db.execute("SELECT ceiling FROM budgets WHERE scope=?",(scope,)).fetchone()
            if existing is None:
                db.execute("INSERT INTO budgets VALUES (?,?)",(scope,ceiling))
            elif existing[0] != ceiling:
                _deny("budget ceiling drift; require separate privileged admin workflow")
            prior=db.execute("SELECT scope,maximum,quote_hash,state FROM operations WHERE op_id=?",
                             (op_id,)).fetchone()
            if prior:
                if prior[:3] != (scope,maximum,digest):
                    _deny("reused operation id with different signed quote")
                db.execute("COMMIT")
                return {"status":prior[3],"op_id":op_id,"reserved_micro_usd":maximum,
                        "deduplicated":True}
            used=self._used(db,scope)
            if used + maximum > ceiling:
                _deny("provider budget ceiling exceeded; no reservation")
            db.execute("""INSERT INTO operations(op_id,scope,provider,maximum,state,quote_hash)
                          VALUES(?,?,?,?,'reserved',?)""",
                       (op_id,scope,q["provider"],maximum,digest))
            db.execute("COMMIT")
            return {"status":"reserved","op_id":op_id,"reserved_micro_usd":maximum,
                    "deduplicated":False}
        except BaseException:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()

    def started(self, op_id: str) -> None:
        """Persistent reservation -> started BEFORE paid call, no automatic retry."""
        _request_id(op_id,"cost operation")
        db=self._connect()
        try:
            if db.execute("UPDATE operations SET state='started' WHERE op_id=? AND state='reserved'",
                          (op_id,)).rowcount!=1:
                _deny("missing, already-started or released cost reservation")
            db.execute("COMMIT")
        except BaseException:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()

    def settle(self, usage: Any, signature: str) -> dict:
        """Provider receipt must be authenticated and actual <= reserved amount."""
        proof=_signed(usage,signature,self._secret(),
            {"version","op_id","provider","receipt_id","actual_micro_usd"},
            "protocolia-usage-proof/v0.1")
        if proof["version"]!="0.1":_deny("unsupported usage evidence")
        op_id=_request_id(proof["op_id"],"cost operation")
        _request_id(proof["provider"],"provider")
        receipt=_request_id(proof["receipt_id"],"metered receipt")
        actual=_amount(proof["actual_micro_usd"])
        digest=hashlib.sha256(_json(proof).encode()).hexdigest()
        db=self._connect()
        try:
            prior=db.execute("SELECT provider,maximum,state,actual,receipt_id,proof_hash "
                             "FROM operations WHERE op_id=?",(op_id,)).fetchone()
            if prior is None:_deny("unknown provider operation")
            provider,maximum,state,stored,old_receipt,old_proof=prior
            if provider!=proof["provider"]:_deny("provider identity mismatch")
            if state=="settled":
                if (stored,old_receipt,old_proof)!=(actual,receipt,digest):
                    _deny("conflicting provider metering evidence")
                db.execute("COMMIT")
                return {"status":"settled","actual_micro_usd":actual,"replayed":True}
            if state!="started":_deny("usage cannot settle an unstarted operation")
            if actual>maximum:
                _deny("cost above reservation; quarantine for operator review")
            if db.execute("SELECT 1 FROM operations WHERE receipt_id=? AND op_id<>?",
                          (receipt,op_id)).fetchone():
                _deny("provider receipt already used for another operation")
            db.execute("""UPDATE operations SET state='settled',actual=?,
                          receipt_id=?,proof_hash=? WHERE op_id=? AND state='started'""",
                       (actual,receipt,digest,op_id))
            db.execute("COMMIT")
            return {"status":"settled","actual_micro_usd":actual,"replayed":False}
        except BaseException:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()

    def release_unstarted(self, op_id: str) -> None:
        """Only a reservation not yet started can return its budget."""
        _request_id(op_id,"cost operation")
        db=self._connect()
        try:
            if db.execute("UPDATE operations SET state='voided' WHERE op_id=? AND state='reserved'",
                          (op_id,)).rowcount!=1:
                _deny("cannot release unknown or potentially spent reservation")
            db.execute("COMMIT")
        except BaseException:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()

    def totals(self, scope: str) -> dict:
        _request_id(scope,"budget scope")
        db=self._connect()
        try:
            row=db.execute("SELECT ceiling FROM budgets WHERE scope=?",(scope,)).fetchone()
            if row is None:_deny("unknown budget scope")
            amount=self._used(db,scope)
            pending=db.execute("SELECT COUNT(*) FROM operations WHERE scope=? AND state='started'",
                               (scope,)).fetchone()[0]
            db.execute("COMMIT")
            return {"scope":scope,"ceiling_micro_usd":row[0],
                    "committed_or_reserved_micro_usd":amount,
                    "remaining_micro_usd":row[0]-amount,
                    "ambiguous_started_attempts":pending}
        except BaseException:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()
