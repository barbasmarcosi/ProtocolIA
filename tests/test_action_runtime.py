"""P3 fail-closed action runtime tests; all effects confined to temporary SQLite."""
import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from protocolia.action_runtime import ExecutionDenied, validate_plan, dry_run, execute

ROOT=Path(__file__).resolve().parents[1]
SAMPLE=json.loads((ROOT/"examples/action-plan-v0.4.json").read_text())
POLICY=json.loads((ROOT/"examples/action-policy-v0.4.json").read_text())

class P3RuntimeTest(unittest.TestCase):
    def setUp(self):
        self.plan=copy.deepcopy(SAMPLE)
        self.policy=copy.deepcopy(POLICY)
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace=Path(self.tmp.name)
    def execute(self, **kwargs):
        return execute(self.plan,self.policy,self.workspace,environment="test-env/1",**kwargs)
    def test_happy_path_replay_and_commit_once(self):
        first=self.execute()
        self.assertEqual(first["status"],"executed")
        self.assertIs(first["outputs"]["verify"],True)
        second=self.execute()
        self.assertEqual(second["status"],"replayed")
        self.assertEqual(first["evidence_sha256"],second["evidence_sha256"])
        with closing(sqlite3.connect(self.workspace/"protocolia-action.sqlite3")) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0],4)
            self.assertEqual(db.execute("SELECT value FROM kv WHERE key='inventory/widget'").fetchone()[0],"two")
    def test_two_concurrent_same_id_commits_effect_only_once(self):
        def invoke(_):
            return execute(self.plan,self.policy,self.workspace,environment="test-env/1")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(invoke,range(2)))
        self.assertEqual(sorted(x["status"] for x in results),["executed","replayed"])
        self.assertEqual(results[0]["evidence_sha256"],results[1]["evidence_sha256"])
        with closing(sqlite3.connect(self.workspace/"protocolia-action.sqlite3")) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM executions").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0],4)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM kv").fetchone()[0],1)
    def test_dry_run_does_not_open_storage(self):
        preview=dry_run(self.plan,self.policy)
        self.assertEqual(preview["writes"],1)
        self.assertFalse((self.workspace/"protocolia-action.sqlite3").exists())
    def test_forbidden_tools_effects_and_forged_capabilities(self):
        for field,value in (("tool","shell"),("effects",[]),("capability","kv.read"),("output_type","boolean")):
            with self.subTest(field=field):
                c=copy.deepcopy(self.plan)
                next(a for a in c["actions"] if a["id"]=="write")[field]=value
                with self.assertRaises(ExecutionDenied):validate_plan(c)
    def test_policy_resource_and_budget_deny_before_state_open(self):
        for change in (("grants", {"kv.write":["inventory/other"]}),("max_writes",0),("max_actions",2),("max_duration_ms",2)):
            with self.subTest(change=change[0]):
                p=copy.deepcopy(self.policy)
                if change[0]=="grants":p["grants"]["kv.write"]=["inventory/other"]
                else:p[change[0]]=change[1]
                with self.assertRaises(ExecutionDenied):dry_run(self.plan,p)
        self.assertFalse((self.workspace/"protocolia-action.sqlite3").exists())
    def test_rejects_key_traversal_and_unsafe_path(self):
        for key in ("../secret","/root","inventory/../secret","inventory\\evil","inventory//widget","inventory/.hidden"):
            with self.subTest(key=key):
                c=copy.deepcopy(self.plan)
                c["actions"][1]["args"]["key"]=key
                with self.assertRaises(ExecutionDenied):validate_plan(c)
    def test_dag_must_bind_dataflow_and_order_effects(self):
        c=copy.deepcopy(self.plan)
        c["actions"][2]["depends_on"]=[]
        with self.assertRaises(ExecutionDenied):validate_plan(c)
        c=copy.deepcopy(self.plan)
        c["actions"][3]["depends_on"]=["seed"]
        with self.assertRaises(ExecutionDenied):validate_plan(c)
        c=copy.deepcopy(self.plan)
        c["actions"][0]["depends_on"]=["verify"]
        with self.assertRaises(ExecutionDenied):validate_plan(c)
        c=copy.deepcopy(self.plan)
        c["actions"][2]["args"]["key"]="inventory/other"
        with self.assertRaises(ExecutionDenied):dry_run(c,self.policy)
    def test_inconsistent_evidence_and_stale_replay_denied(self):
        self.execute()
        with closing(sqlite3.connect(self.workspace/"protocolia-action.sqlite3")) as db:
            db.execute("UPDATE kv SET value='tampered' WHERE key='inventory/widget'")
            db.commit()
        with self.assertRaisesRegex(ExecutionDenied,"stale external state"):self.execute()
    def test_plan_or_policy_or_environment_change_invalidates(self):
        self.execute()
        self.plan["actions"][0]["args"]["value"]="three"
        with self.assertRaisesRegex(ExecutionDenied,"stale plan"):self.execute()
        self.plan=copy.deepcopy(SAMPLE)
        changed=copy.deepcopy(self.policy)
        changed["max_actions"]=5
        with self.assertRaisesRegex(ExecutionDenied,"stale plan"):
            execute(self.plan,changed,self.workspace,environment="test-env/1")
        with self.assertRaisesRegex(ExecutionDenied,"stale plan"):
            execute(self.plan,self.policy,self.workspace,environment="test-env/2")
    def test_forged_event_detected(self):
        self.execute()
        with closing(sqlite3.connect(self.workspace/"protocolia-action.sqlite3")) as db:
            db.execute("UPDATE events SET event_json='{}' WHERE seq=0")
            db.commit()
        with self.assertRaisesRegex(ExecutionDenied,"inconsistent action"):self.execute()
    def test_cancel_and_postcondition_roll_back_atomic_write(self):
        calls=[0]
        def cancel():
            calls[0]+=1
            return calls[0]>=5
        with self.assertRaisesRegex(ExecutionDenied,"cancelled"):self.execute(cancelled=cancel)
        with closing(sqlite3.connect(self.workspace/"protocolia-action.sqlite3")) as db:
            # First-time DDL also rolls back when the effect transaction fails.
            tables={name for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "kv" in tables:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM kv").fetchone()[0],0)
            if "executions" in tables:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM executions").fetchone()[0],0)
        self.plan["actions"][3]["args"]["right"]="wrong"
        with self.assertRaisesRegex(ExecutionDenied,"postcondition failed"):self.execute()
        with closing(sqlite3.connect(self.workspace/"protocolia-action.sqlite3")) as db:
            tables={name for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "kv" in tables:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM kv").fetchone()[0],0)
    def test_clock_timeout_denies_and_rolls_back(self):
        ticks=[0]
        def clock():
            ticks[0]+=1
            return ticks[0]*0.5
        self.policy["max_duration_ms"]=1000
        with self.assertRaisesRegex(ExecutionDenied,"deadline exceeded"):self.execute(clock=clock)
    def test_evidence_expiry_denies_replay_without_duplicate_effects(self):
        first=self.execute(wall_clock=lambda: 1000.0)
        self.assertEqual(first["status"],"executed")
        same=self.execute(wall_clock=lambda: 1000.5)
        self.assertEqual(same["status"],"replayed")
        with self.assertRaisesRegex(ExecutionDenied,"expired or future-dated"):
            self.execute(wall_clock=lambda: 1601.0)
        with self.assertRaisesRegex(ExecutionDenied,"expired or future-dated"):
            self.execute(wall_clock=lambda: 999.0)
        with closing(sqlite3.connect(self.workspace/"protocolia-action.sqlite3")) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM executions").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0],4)
    def test_zero_freshness_window_denied_by_policy(self):
        self.policy["max_evidence_age_ms"]=0
        with self.assertRaises(ExecutionDenied):dry_run(self.plan,self.policy)
    def test_existing_symlink_workspace_denied(self):
        alias=self.workspace/"shortcut"
        alias.symlink_to(self.workspace,target_is_directory=True)
        with self.assertRaisesRegex(ExecutionDenied,"symlink"):
            execute(self.plan,self.policy,alias,environment="test-env/1")
    def test_required_environment_and_reject_unknown_fields(self):
        with self.assertRaises(ExecutionDenied):
            execute(self.plan,self.policy,self.workspace,environment="")
        self.plan["actions"][0]["custom_python"]="print('hi')"
        with self.assertRaises(ExecutionDenied):validate_plan(self.plan)
