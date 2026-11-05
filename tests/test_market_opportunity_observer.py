import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
from market_opportunity_observer import evaluate

def quotes():
    return {
        "BTCUSDT": {"symbol":"BTCUSDT","bidPrice":"99900","askPrice":"100000","bidQty":"10","askQty":"10"},
        "ETHBTC": {"symbol":"ETHBTC","bidPrice":"0.0499","askPrice":"0.05","bidQty":"100","askQty":"100"},
        "ETHUSDT": {"symbol":"ETHUSDT","bidPrice":"4990","askPrice":"5010","bidQty":"100","askQty":"100"}
    }

class ObserverTests(unittest.TestCase):
    def test_normal_spread_is_not_opportunity(self):
        rows=evaluate(quotes())
        self.assertEqual(len(rows),2)
        self.assertTrue(all(r["net_pct"] < 0 for r in rows))
        self.assertTrue(all(r["top_of_book_capacity_ok"] for r in rows))

    def test_cross_market_price_discrepancy_is_detected(self):
        q=quotes()
        q["ETHUSDT"]["bidPrice"]="5200"
        q["ETHUSDT"]["askPrice"]="5210"
        rows=evaluate(q)
        self.assertGreater(rows[0]["net_pct"],0)
        self.assertLess(rows[1]["net_pct"],0)

    def test_insufficient_liquidity_is_flagged(self):
        q=quotes()
        q["BTCUSDT"]["askQty"]="0.00001"
        self.assertFalse(evaluate(q)[0]["top_of_book_capacity_ok"])

    def test_invalid_quotes_fail_closed(self):
        q=quotes()
        q["ETHBTC"]["askPrice"]="nan"
        with self.assertRaises(ValueError): evaluate(q)

    def test_crossed_quotes_fail_closed(self):
        q=quotes()
        q["ETHUSDT"]["bidPrice"]="6000"
        with self.assertRaises(ValueError): evaluate(q)

    def test_invalid_capital_and_fees(self):
        for capital, fee in ((0,0.001), (float("nan"),0.001), (50,-0.1), (50,1)):
            with self.assertRaises(ValueError): evaluate(quotes(),capital,fee)

if __name__=="__main__":
    unittest.main()
