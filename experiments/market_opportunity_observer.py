"""Read-only triangular spot quote observer. No order endpoints or credentials."""
import argparse
import json
import math
import urllib.request
from datetime import datetime, timezone

SYMBOLS = ("BTCUSDT", "ETHBTC", "ETHUSDT")
BASE = "https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol="
DEFAULT_FEE = 0.001  # per leg; illustrative, not account-specific

def validate(quote, symbol):
    if quote.get("symbol") != symbol:
        raise ValueError("unexpected symbol")
    fields = {}
    for key in ("bidPrice", "askPrice", "bidQty", "askQty"):
        try:
            value = float(quote[key])
        except (KeyError, ValueError, TypeError):
            raise ValueError("invalid quote")
        if not math.isfinite(value) or value <= 0:
            raise ValueError("invalid quote")
        fields[key] = value
    if fields["bidPrice"] > fields["askPrice"]:
        raise ValueError("crossed quote")
    return fields

def evaluate(quotes, capital=50.0, fee=DEFAULT_FEE):
    if not math.isfinite(capital) or capital <= 0 or not math.isfinite(fee) or not 0 <= fee < 1:
        raise ValueError("invalid settings")
    b, e, u = (validate(quotes[s], s) for s in SYMBOLS)
    # USDT -> BTC (buy BTCUSDT) -> ETH (buy ETHBTC) -> USDT (sell ETHUSDT)
    btc = capital / b["askPrice"] * (1-fee)
    eth = btc / e["askPrice"] * (1-fee)
    finish_a = eth * u["bidPrice"] * (1-fee)
    capacity_a = (capital / b["askPrice"] <= b["askQty"] and
                  btc / e["askPrice"] <= e["askQty"] and eth <= u["bidQty"])
    # USDT -> ETH (buy ETHUSDT) -> BTC (sell ETHBTC) -> USDT (sell BTCUSDT)
    eth2 = capital / u["askPrice"] * (1-fee)
    btc2 = eth2 * e["bidPrice"] * (1-fee)
    finish_b = btc2 * b["bidPrice"] * (1-fee)
    capacity_b = (capital / u["askPrice"] <= u["askQty"] and
                  eth2 <= e["bidQty"] and btc2 <= b["bidQty"])
    return [
        {"route": "USDT-BTC-ETH-USDT", "net_pct": round(100*(finish_a/capital-1), 6),
         "top_of_book_capacity_ok": capacity_a},
        {"route": "USDT-ETH-BTC-USDT", "net_pct": round(100*(finish_b/capital-1), 6),
         "top_of_book_capacity_ok": capacity_b},
    ]

def fetch_quotes():
    result = {}
    for symbol in SYMBOLS:
        request = urllib.request.Request(BASE+symbol, headers={"User-Agent": "RotationLab-ReadOnlyObserver/1.0"})
        with urllib.request.urlopen(request, timeout=6) as response:
            data = response.read(8193)
            if len(data) > 8192:
                raise ValueError("oversized quote")
            result[symbol] = json.loads(data)
            validate(result[symbol], symbol)
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Fetch public quotes; still no trading")
    parser.add_argument("--capital", type=float, default=50.0)
    parser.add_argument("--fee", type=float, default=DEFAULT_FEE)
    args = parser.parse_args()
    if not args.live:
        parser.error("No quotes fetched by default. Use --live for public read-only snapshot.")
    quotes = fetch_quotes()
    print(json.dumps({"mode": "OBSERVE_ONLY", "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "capital_usdt": args.capital, "fee_per_leg": args.fee,
        "results": evaluate(quotes, args.capital, args.fee),
        "limitations": "Sequential REST quotes are not atomic; no latency, withdrawal, deeper-book or fill guarantee."}, indent=2))

if __name__ == "__main__":
    main()
