
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const BASE = "https://api.coindcx.com";
const PUBLIC = "https://public.coindcx.com";

// -------------------- COMMON API FUNCTION --------------------

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 CoinDCXScanner"
      },
      signal: controller.signal
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        "CoinDCX HTTP " + response.status + ": " + body.slice(0, 200)
      );
    }

    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

// -------------------- EXTRACT ACTIVE PAIRS --------------------

function extractPairs(data) {
  if (!Array.isArray(data)) {
    throw new Error("Unexpected CoinDCX instruments response");
  }

  return [
    ...new Set(
      data
        .map(item => {
          if (typeof item === "string") {
            return item.trim().toUpperCase();
          }

          return String(
            item?.pair ||
            item?.symbol ||
            item?.instrument_name ||
            ""
          ).trim().toUpperCase();
        })
        .filter(pair => /^B-[A-Z0-9_-]+_USDT$/.test(pair))
    )
  ];
}

// -------------------- HEALTH CHECK --------------------

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    exchange: "CoinDCX"
  });
});

// -------------------- ACTIVE USDT PAIRS --------------------

app.get("/api/pairs", async (req, res) => {
  try {
    const url =
      BASE +
      "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";

    const data = await getJSON(url);
    const pairs = extractPairs(data);

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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// -------------------- LIVE FUTURES PRICES --------------------

app.get("/api/prices", async (req, res) => {
  try {
    const [instrumentData, priceData] = await Promise.all([
      getJSON(
        BASE +
        "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
      ),
      getJSON(
        PUBLIC +
        "/market_data/v3/current_prices/futures/rt"
      )
    ]);

    const pairs = extractPairs(instrumentData);

    // CoinDCX returns prices inside the "prices" object.
    const livePrices = priceData.prices || {};
    const prices = {};

    for (const pair of pairs) {
      const price = livePrices[pair];

      if (price && (price.ls != null || price.mp != null)) {
        prices[pair] = price;
      }
    }

    res.json({
      success: true,
      exchange: "CoinDCX",
      count: Object.keys(prices).length,
      prices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// -------------------- CANDLE DATA --------------------

app.get("/api/candles", async (req, res) => {
  try {
    const pair = String(req.query.pair || "").toUpperCase();
    const interval = String(req.query.interval || "60");

    const allowedIntervals = ["1", "5", "60", "1D"];

    if (!/^B-[A-Z0-9_-]+_USDT$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid CoinDCX USDT pair"
      });
    }

    if (!allowedIntervals.includes(interval)) {
      return res.status(400).json({
        success: false,
        error: "Invalid candle interval"
      });
    }

    const instrumentData = await getJSON(
      BASE +
      "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
    );

    const activePairs = extractPairs(instrumentData);

    if (!activePairs.includes(pair)) {
      return res.status(404).json({
        success: false,
        error: "Pair is not an active CoinDCX USDT contract"
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const days = interval === "1D" ? 180 : 10;
    const from = now - days * 24 * 60 * 60;

    const url =
      PUBLIC +
      "/market_data/candlesticks" +
      "?pair=" + encodeURIComponent(pair) +
      "&from=" + from +
      "&to=" + now +
      "&resolution=" + encodeURIComponent(interval) +
      "&pcode=f";

    const data = await getJSON(url);

    if (data.s !== "ok" || !Array.isArray(data.data)) {
      throw new Error("CoinDCX returned invalid candle data");
    }

    res.json({
      success: true,
      exchange: "CoinDCX",
      pair,
      interval,
      candles: data.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// -------------------- START SERVER --------------------

app.listen(PORT, () => {
  console.log("CoinDCX Scanner running on port " + PORT);
});
