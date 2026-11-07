
const express = require("express");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "CoinDCX-Verified-Scanner/2.0",
        "Accept": "application/json"
      }
    }, (res) => {
      let body = "";

      res.on("data", chunk => body += chunk);

      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error("CoinDCX HTTP " + res.statusCode)
          );
        }

        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error("Invalid JSON response"));
        }
      });
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error("API timeout"));
    });

    req.on("error", reject);
  });
}

function unwrapArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.result)) return value.result;
  if (value && Array.isArray(value.instruments)) {
    return value.instruments;
  }
  return [];
}

function getPair(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";

  return String(
    item.pair ||
    item.instrument_name ||
    item.symbol ||
    item.market ||
    ""
  );
}

const PAIRS_URL =
  "https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    exchange: "CoinDCX"
  });
});

// ACTIVE COINDCX PAIRS
app.get("/api/pairs", async (req, res) => {
  try {
    const raw = await getJSON(PAIRS_URL);

    const pairs = unwrapArray(raw)
      .map(getPair)
      .filter(Boolean);

    if (!pairs.length) {
      throw new Error("No active CoinDCX pairs found");
    }

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      exchange: "CoinDCX",
      count: pairs.length,
      pairs
    });

  } catch (e) {
    console.error("PAIR ERROR:", e.message);

    res.status(502).json({
      success: false,
      error: e.message
    });
  }
});

// LIVE FUTURES PRICES
app.get("/api/prices", async (req, res) => {
  try {
    const [pairData, priceData] = await Promise.all([
      getJSON(PAIRS_URL),
      getJSON(
        "https://public.coindcx.com/market_data/v3/current_prices/futures/rt"
      )
    ]);

    const active = unwrapArray(pairData)
      .map(getPair)
      .filter(Boolean);

    const allowed = new Set(active);
    const prices = {};

    for (const [key, value] of Object.entries(priceData || {})) {
      if (allowed.has(key) && value) {
        prices[key] = value;
      }
    }

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      exchange: "CoinDCX",
      activeCount: active.length,
      prices
    });

  } catch (e) {
    console.error("PRICE ERROR:", e.message);

    res.status(502).json({
      success: false,
      error: e.message
    });
  }
});

// COINDCX VERIFIED CANDLES
app.get("/api/candles", async (req, res) => {
  try {
    const pair = String(req.query.pair || "");
    const interval = String(req.query.interval || "15");

    const allowedIntervals = ["5", "15", "60", "1D"];

    if (!/^[A-Za-z0-9_-]+$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid pair"
      });
    }

    if (!allowedIntervals.includes(interval)) {
      return res.status(400).json({
        success: false,
        error: "Invalid interval"
      });
    }

    // Verify pair against active CoinDCX contracts
    const rawPairs = await getJSON(PAIRS_URL);

    const activePairs = unwrapArray(rawPairs)
      .map(getPair);

    if (!activePairs.includes(pair)) {
      return res.status(403).json({
        success: false,
        error: "Pair not listed on CoinDCX"
      });
    }

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 100, 55),
      200
    );

    const to = Math.floor(Date.now() / 1000);

    const seconds =
      interval === "60" ? 3600 :
      interval === "1D" ? 86400 :
      Number(interval) * 60;

    const from = to - limit * seconds;

    const url =
      "https://public.coindcx.com/market_data/candlesticks?" +
      "pair=" + encodeURIComponent(pair) +
      "&from=" + from +
      "&to=" + to +
      "&resolution=" + encodeURIComponent(interval) +
      "&pcode=f";

    const raw = await getJSON(url);
    const candles = unwrapArray(raw);

    if (!candles.length) {
      throw new Error("No CoinDCX candles returned");
    }

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      exchange: "CoinDCX",
      pair,
      interval,
      candles
    });

  } catch (e) {
    console.error("CANDLE ERROR:", e.message);

    res.status(502).json({
      success: false,
      error: e.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "CoinDCX verified scanner running on port " + PORT
  );
});
