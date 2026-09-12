"""Check preparation consistency only. Does not load Rust, a UI, XLSX or a host."""
from decimal import Decimal
import json
from pathlib import Path
import unittest

DATA = json.loads(Path(__file__).with_name("scenarios.json").read_text(encoding="utf-8"))
J = {case["id"]: case for case in DATA["journeys"]}


class PreparationChecks(unittest.TestCase):
    def test_scope_and_status(self):
        self.assertEqual(DATA["status"], "PREPARED_NOT_RUNTIME_QUALIFIED")
        self.assertEqual(len(DATA["journeys"]), 6)
        self.assertEqual(set(J), {f"J{i}" for i in range(1, 7)})
        self.assertEqual({b for case in J.values() for b in case["bundles"]}, set(range(1, 16)))
        self.assertTrue(all(case["required_negative"] for case in J.values()))

    def test_tracker(self):
        case = J["J1"]
        rows = sorted(case["tasks"], key=lambda row: row[2])
        self.assertEqual([r[0] for r in rows], case["sorted_names"])
        self.assertEqual([r[0] for r in rows if r[1] == "Todo"], case["filtered_todo_names"])
        lo, hi = case["priority_range"]
        self.assertTrue(lo <= case["accepted_priority"] <= hi)
        self.assertFalse(lo <= case["rejected_priority"] <= hi)

    def test_plan(self):
        case = J["J2"]
        rate = Decimal(case["fixed_rate"])
        self.assertEqual([Decimal(v) * rate for v in case["expenses"]], case["reserves"])
        self.assertEqual(sum(case["reserves"]), case["total"])
        self.assertEqual(sum(case["duplicate_expenses"]) * rate, case["duplicate_total"])
        self.assertEqual(case["total"] + case["duplicate_total"], case["cross_sheet_total"])

    def test_cleanup(self):
        case = J["J3"]
        cleaned = list(dict.fromkeys((name.strip(), int(q), int(p)) for name, q, p in case["raw_rows"]))
        self.assertEqual([list(row) for row in cleaned], case["clean_rows"])
        self.assertEqual(sum(q * p for _, q, p in cleaned), case["total"])
        self.assertEqual(case["preserve_as_text"], "0012")

    def test_summary(self):
        case = J["J4"]
        prices = dict(case["catalog"])
        lines = [prices[key] * quantity for key, quantity in case["sales"]]
        self.assertEqual(lines, case["line_totals"])
        groups = {key: sum(p * q for k, q in case["sales"] if k == key) for key, p in case["catalog"]}
        self.assertEqual(list(map(list, groups.items())), case["group_totals"])
        self.assertEqual(sum(lines), case["total"])
        self.assertNotIn(case["missing_key"], prices)
        self.assertIn(case["duplicate_key"], prices)

    def test_report(self):
        case = J["J5"]
        source = J[case["source_journey"]]
        prices = dict(source["catalog"])
        prices["PEN"] = case["new_pen_price"]
        groups = [[key, price * sum(q for k, q in source["sales"] if k == key)] for key, price in prices.items()]
        self.assertEqual(groups, case["group_totals"])
        self.assertEqual(sum(total for _, total in groups), case["total"])

    def test_continuation(self):
        case = J["J6"]
        self.assertEqual(case["before_total"], J["J2"]["total"])
        self.assertEqual(case["after_total"], J["J2"]["duplicate_total"])
        self.assertEqual(len(set(case["required_faults"])), 6)


if __name__ == "__main__":
    print("PREPARATION ONLY: passing checks do not qualify product behavior or release.", flush=True)
    unittest.main(verbosity=2)
