
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const BASE = "https://api.coindcx.com";
const PUBLIC = "https://public.coindcx.com";

async function getJSON(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    signal: AbortSignal.timeout(20000)
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error("CoinDCX HTTP " + response.status + ": " + body.slice(0, 300));
  }

  return JSON.parse(body);
}

function extractPairs(data) {
  if (!Array.isArray(data)) {
    throw new Error("Unexpected CoinDCX instruments response");
  }

  return [...new Set(data.map(item => {
    if (typeof item === "string") {
      return item.trim().toUpperCase();
    }

    return String(
      item?.pair ||
      item?.symbol ||
      item?.instrument_name ||
      ""
    ).trim().toUpperCase();
  }).filter(pair => /^B-[A-Z0-9_-]+_USDT$/.test(pair)))];
}

async function getActivePairs() {
  const data = await getJSON(
    BASE + "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
  );

  return extractPairs(data);
}

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    exchange: "CoinDCX"
  });
});

// ACTIVE FUTURES PAIRS

app.get("/api/pairs", async (req, res) => {
  try {
    const pairs = await getActivePairs();

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

// LIVE PRICES

app.get("/api/prices", async (req, res) => {
  try {
    const [activePairs, priceData] = await Promise.all([
      getActivePairs(),
      getJSON(PUBLIC + "/market_data/v3/current_prices/futures/rt")
    ]);

    // CoinDCX may return the pair map directly,
    // or inside a prices/data wrapper.
    let priceContainer =
      priceData?.prices ||
      priceData?.data?.prices ||
      priceData?.result?.prices ||
      priceData;

    if (
      priceContainer &&
      !Array.isArray(priceContainer) &&
      typeof priceContainer === "object" &&
      priceContainer.data &&
      typeof priceContainer.data === "object"
    ) {
      priceContainer = priceContainer.data;
    }

    const prices = {};

    for (const pair of activePairs) {
      const value = priceContainer?.[pair];

      if (value && typeof value === "object") {
        const lastPrice = Number(value.ls);
        const markPrice = Number(value.mp);

        if (
          Number.isFinite(lastPrice) ||
          Number.isFinite(markPrice)
        ) {
          prices[pair] = {
            last_price: Number.isFinite(lastPrice) ? lastPrice : null,
            mark_price: Number.isFinite(markPrice) ? markPrice : null,
            volume: Number(value.v) || 0,
            market: value.mkt || pair
          };
        }
      }
    }

    res.json({
      success: true,
      exchange: "CoinDCX",
      active_pairs: activePairs.length,
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

// CANDLE DATA

app.get("/api/candles", async (req, res) => {
  try {
    const pair = String(req.query.pair || "").toUpperCase();
    const interval = String(req.query.interval || "60");

    if (!/^B-[A-Z0-9_-]+_USDT$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid CoinDCX USDT pair"
      });
    }

    if (!["1", "5", "60", "1D"].includes(interval)) {
      return res.status(400).json({
        success: false,
        error: "Invalid candle interval"
      });
    }

    const activePairs = await getActivePairs();

    if (!activePairs.includes(pair)) {
      return res.status(404).json({
        success: false,
        error: "Pair is not active on CoinDCX"
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const days = interval === "1D" ? 180 : 10;
    const from = now - days * 86400;

    const url =
      PUBLIC +
      "/market_data/candlesticks?pair=" +
      encodeURIComponent(pair) +
      "&from=" + from +
      "&to=" + now +
      "&resolution=" + encodeURIComponent(interval) +
      "&pcode=f";

    const data = await getJSON(url);

    if (data.s !== "ok" || !Array.isArray(data.data)) {
      throw new Error("Invalid CoinDCX candle response");
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

app.listen(PORT, () => {
  console.log("CoinDCX Scanner running on port " + PORT);
});
