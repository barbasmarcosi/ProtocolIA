"""P3 durable micro-USD budgets: real SQLite locking and adversarial HMAC evidence."""
import copy
from concurrent.futures import ThreadPoolExecutor
import secrets
from pathlib import Path
import tempfile
import unittest

from protocolia.action_runtime import ExecutionDenied
from protocolia.cost_ledger import CostLedger, sign_quote, sign_usage

class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.key=secrets.token_bytes(32)
        self.secret=self.root/"authority-key"
        self.secret.write_bytes(self.key)
        self.secret.chmod(0o600)
        self.ledger=CostLedger(self.root,self.secret,now=lambda:100.0)
    def quote(self,op="payone",maximum=6,scope="mission1",expires=300,provider="vendor1"):
        data={"version":"0.1","op_id":op,"scope":scope,"provider":provider,
              "max_micro_usd":maximum,"expires_at":expires}
        return data,sign_quote(data,self.key)
    def usage(self,op="payone",actual=2,receipt="receiptone",provider="vendor1"):
        data={"version":"0.1","op_id":op,"provider":provider,
              "receipt_id":receipt,"actual_micro_usd":actual}
        return data,sign_usage(data,self.key)
    def reserve(self,op="payone",maximum=6,ceiling=10):
        return self.ledger.reserve(*self.quote(op,maximum),budget_ceiling=ceiling)
    def test_atomic_reserve_settle_and_reuse_remaining(self):
        self.assertEqual(self.reserve()["status"],"reserved")
        self.assertFalse(self.reserve()["deduplicated"] is False)
        self.assertEqual(self.ledger.totals("mission1")["remaining_micro_usd"],4)
        with self.assertRaisesRegex(ExecutionDenied,"ceiling"):
            self.reserve("paytwo",5)
        self.ledger.started("payone")
        self.assertEqual(self.ledger.settle(*self.usage())["status"],"settled")
        self.assertEqual(self.ledger.totals("mission1")["remaining_micro_usd"],8)
        self.assertTrue(self.ledger.settle(*self.usage())["replayed"])
        self.assertEqual(self.reserve("paytwo",8)["status"],"reserved")
        self.assertEqual(self.ledger.totals("mission1")["remaining_micro_usd"],0)
    def test_unknown_cost_or_forged_quote_fails_without_reservation(self):
        for value in (None,-1,1.25,True,10**14):
            with self.subTest(value=value):
                q,signature=self.quote(maximum=5)
                q["max_micro_usd"]=value
                with self.assertRaises(ExecutionDenied):
                    self.ledger.reserve(q,signature,budget_ceiling=10)
        q,signature=self.quote()
        with self.assertRaisesRegex(ExecutionDenied,"signature"):
            self.ledger.reserve(q,"0"*64,budget_ceiling=10)
    def test_unknown_usage_or_wrong_signer_does_not_settle(self):
        self.reserve()
        self.ledger.started("payone")
        for value in (None,1.2,False,-10,7):
            with self.subTest(value=value):
                receipt,sig=self.usage(actual=value)
                with self.assertRaises(ExecutionDenied):
                    self.ledger.settle(receipt,sig)
        receipt,sig=self.usage()
        with self.assertRaisesRegex(ExecutionDenied,"signature"):
            self.ledger.settle(receipt,"0"*64)
        self.assertEqual(self.ledger.totals("mission1")["ambiguous_started_attempts"],1)
        self.assertEqual(self.ledger.totals("mission1")["remaining_micro_usd"],4)
    def test_no_double_start_or_unsafe_release(self):
        self.reserve()
        self.ledger.started("payone")
        with self.assertRaises(ExecutionDenied):self.ledger.started("payone")
        with self.assertRaises(ExecutionDenied):self.ledger.release_unstarted("payone")
        self.assertEqual(self.ledger.totals("mission1")["remaining_micro_usd"],4)
    def test_release_only_unstarted_and_no_implicit_retry(self):
        self.reserve()
        self.ledger.release_unstarted("payone")
        self.assertEqual(self.ledger.totals("mission1")["remaining_micro_usd"],10)
        self.assertEqual(self.reserve()["status"],"voided")
        with self.assertRaises(ExecutionDenied):self.ledger.started("payone")
    def test_conflicting_quote_and_budget_drift_rejected(self):
        self.reserve()
        q,sig=self.quote(maximum=7)
        with self.assertRaisesRegex(ExecutionDenied,"reused operation"):
            self.ledger.reserve(q,sig,budget_ceiling=10)
        q,sig=self.quote(op="paytwo",maximum=2)
        with self.assertRaisesRegex(ExecutionDenied,"ceiling drift"):
            self.ledger.reserve(q,sig,budget_ceiling=999)
    def test_receipt_unique_and_replay_rejects_changed_usage(self):
        self.reserve()
        self.ledger.started("payone")
        self.ledger.settle(*self.usage())
        self.reserve("paytwo",3)
        self.ledger.started("paytwo")
        with self.assertRaisesRegex(ExecutionDenied,"already used"):
            self.ledger.settle(*self.usage(op="paytwo",receipt="receiptone"))
        with self.assertRaisesRegex(ExecutionDenied,"conflicting"):
            self.ledger.settle(*self.usage(actual=3))
    def test_atomic_concurrent_reservations_never_overspend(self):
        def tryreserve(i):
            try:
                return self.reserve("payment"+str(i),3)["status"]
            except ExecutionDenied:
                return "denied"
        with ThreadPoolExecutor(max_workers=8) as executor:
            results=list(executor.map(tryreserve,range(8)))
        self.assertEqual(results.count("reserved"),3)
        self.assertEqual(self.ledger.totals("mission1")["remaining_micro_usd"],1)
    def test_started_after_crash_stays_quarantined_and_budget_reserved(self):
        self.reserve()
        self.ledger.started("payone")
        restarted=CostLedger(self.root,self.secret,now=lambda:100.0)
        self.assertEqual(restarted.totals("mission1")["ambiguous_started_attempts"],1)
        self.assertEqual(restarted.reserve(*self.quote(),budget_ceiling=10)["status"],"started")
        with self.assertRaises(ExecutionDenied):restarted.started("payone")
        with self.assertRaises(ExecutionDenied):restarted.release_unstarted("payone")
    def test_missing_or_public_host_signer_key_denied(self):
        self.secret.chmod(0o644)
        with self.assertRaises(ExecutionDenied):self.reserve()
        self.secret.chmod(0o600)
        self.secret.unlink()
        with self.assertRaises(ExecutionDenied):self.reserve()
