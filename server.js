
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const BASE = "https://api.coindcx.com";
const PUBLIC = "https://public.coindcx.com";

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 CoinDCXScanner"
      },
      signal: controller.signal
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error("HTTP " + response.status + ": " + body.slice(0, 150));
    }

    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

function extractPairs(data) {
  if (!Array.isArray(data)) {
    throw new Error("Unexpected CoinDCX instruments response");
  }

  return [...new Set(data.map(item => {
    if (typeof item === "string") return item.trim().toUpperCase();

    return String(
      item?.pair ||
      item?.symbol ||
      item?.instrument_name ||
      ""
    ).trim().toUpperCase();
  }).filter(pair => /^B-[A-Z0-9_-]+_USDT$/.test(pair)))];
}

// Health
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    exchange: "CoinDCX"
  });
});

// Active pairs
app.get("/api/pairs", async (req, res) => {
  try {
    const url = BASE +
      "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";

    const data = await getJSON(url);
    const pairs = extractPairs(data);

    if (!pairs.length) {
      throw new Error("CoinDCX returned zero valid USDT pairs");
    }

    console.log("CoinDCX active pairs:", pairs.length);

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      exchange: "CoinDCX",
      count: pairs.length,
      pairs: pairs.map(pair => ({
        pair,
        symbol: pair,
        instrument_name: pair,
        market: pair
      }))
    });

  } catch (error) {
    console.error("PAIRS ERROR:", error.message);

    res.status(502).json({
      success: false,
      exchange: "CoinDCX",
      error: error.message,
      pairs: []
    });
  }
});

// Live futures prices
app.get("/api/prices", async (req, res) => {
  try {
    const pairData = await getJSON(
      BASE +
      "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
    );

    const pairs = extractPairs(pairData);

    const priceData = await getJSON(
      PUBLIC + "/market_data/v3/current_prices/futures/rt"
    );

    const allowed = new Set(pairs);
    const prices = {};

    for (const [key, value] of Object.entries(priceData || {})) {
      if (allowed.has(key)) {
        prices[key] = value;
      }
    }

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      exchange: "CoinDCX",
      count: Object.keys(prices).length,
      prices
    });

  } catch (error) {
    console.error("PRICE ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: error.message,
      prices: {}
    });
  }
});

// Candles
app.get("/api/candles", async (req, res) => {
  try {
    const pair = String(req.query.pair || "").trim().toUpperCase();
    const interval = String(req.query.interval || "5");

    if (!/^B-[A-Z0-9_-]+_USDT$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid CoinDCX pair"
      });
    }

    if (!["1", "5", "60", "1D"].includes(interval)) {
      return res.status(400).json({
        success: false,
        error: "Unsupported interval"
      });
    }

    const active = extractPairs(await getJSON(
      BASE +
      "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
    ));

    if (!active.includes(pair)) {
      return res.status(403).json({
        success: false,
        error: "Pair not active on CoinDCX"
      });
    }

    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 86400;

    const params = new URLSearchParams({
      pair,
      from: String(from),
      to: String(to),
      resolution: interval,
      pcode: "f"
    });

    const data = await getJSON(
      PUBLIC + "/market_data/candlesticks?" + params.toString()
    );

    if (data.s !== "ok" || !Array.isArray(data.data)) {
      throw new Error("Invalid CoinDCX candle response");
    }

    res.set("Cache-Control", "no-store");

    res.json({
      success: true,
      exchange: "CoinDCX",
      pair,
      interval,
      candles: data.data
    });

  } catch (error) {
    console.error("CANDLE ERROR:", error.message);

    res.status(502).json({
      success: false,
      error: error.message,
      candles: []
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("CoinDCX scanner backend running on port " + PORT);
});
