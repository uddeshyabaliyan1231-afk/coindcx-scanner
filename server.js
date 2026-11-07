
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
    throw new Error("HTTP " + response.status + ": " + body.slice(0, 300));
  }

  return JSON.parse(body);
}

function extractPairs(data) {
  if (!Array.isArray(data)) {
    throw new Error("Unexpected instruments response");
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

app.get("/health", (req, res) => {
  res.json({ success: true, status: "online" });
});

app.get("/api/pairs", async (req, res) => {
  try {
    const data = await getJSON(
      BASE + "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
    );

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

app.get("/api/prices", async (req, res) => {
  try {
    const [instrumentData, priceData] = await Promise.all([
      getJSON(
        BASE + "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
      ),
      getJSON(
        PUBLIC + "/market_data/v3/current_prices/futures/rt"
      )
    ]);

    const activePairs = extractPairs(instrumentData);

    const priceContainer =
      priceData?.prices ||
      priceData?.data?.prices ||
      priceData?.result?.prices ||
      {};

    const priceKeys = Object.keys(priceContainer);

    const prices = {};

    for (const pair of activePairs) {
      const value = priceContainer[pair];

      if (value !== undefined && value !== null) {
        prices[pair] = value;
      }
    }

    res.json({
      success: true,
      exchange: "CoinDCX",
      count: Object.keys(prices).length,

      diagnostics: {
        activePairCount: activePairs.length,
        activePairsSample: activePairs.slice(0, 10),
        priceResponseTopLevelKeys: Object.keys(priceData || {}),
        priceContainerCount: priceKeys.length,
        priceKeysSample: priceKeys.slice(0, 10),
        priceSample: priceKeys.length
          ? priceContainer[priceKeys[0]]
          : null
      },

      prices
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/candles", async (req, res) => {
  try {
    const pair = String(req.query.pair || "").toUpperCase();
    const interval = String(req.query.interval || "60");

    if (!/^B-[A-Z0-9_-]+_USDT$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid pair"
      });
    }

    if (!["1", "5", "60", "1D"].includes(interval)) {
      return res.status(400).json({
        success: false,
        error: "Invalid interval"
      });
    }

    const instrumentData = await getJSON(
      BASE + "/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT"
    );

    const activePairs = extractPairs(instrumentData);

    if (!activePairs.includes(pair)) {
      return res.status(404).json({
        success: false,
        error: "Inactive CoinDCX pair"
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const from = now - 10 * 24 * 60 * 60;

    const url =
      PUBLIC +
      "/market_data/candlesticks?pair=" +
      encodeURIComponent(pair) +
      "&from=" + from +
      "&to=" + now +
      "&resolution=" + interval +
      "&pcode=f";

    const data = await getJSON(url);

    if (data.s !== "ok" || !Array.isArray(data.data)) {
      throw new Error("Invalid candle response");
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
  console.log("CoinDCX diagnostic scanner running on port " + PORT);
});
