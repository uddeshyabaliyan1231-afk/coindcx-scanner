
const express = require("express");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "CoinDCX-Scanner/3.0",
        "Accept": "application/json"
      }
    }, res => {
      let body = "";

      res.on("data", chunk => body += chunk);

      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(
            `CoinDCX HTTP ${res.statusCode}: ${body.slice(0, 250)}`
          ));
        }

        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error("Invalid CoinDCX JSON: " + e.message));
        }
      });
    });

    req.setTimeout(20000, () =>
      req.destroy(new Error("CoinDCX API timeout"))
    );

    req.on("error", reject);
  });
}

function extractArray(data, keys = []) {
  if (Array.isArray(data)) return data;

  if (data && typeof data === "object") {
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }
  }

  return null;
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok", scanner: "CoinDCX" });
});

app.get("/api/pairs", async (req, res) => {
  try {
    const url =
      "https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";

    const data = await getJSON(url);
    const pairs = extractArray(data, [
      "data",
      "instruments",
      "result"
    ]);

    if (!pairs) {
      throw new Error("Unexpected instruments response format");
    }

    res.json({
      success: true,
      count: pairs.length,
      pairs
    });

  } catch (e) {
    console.error("[PAIRS ERROR]", e.message);
    res.status(502).json({
      success: false,
      error: e.message
    });
  }
});

app.get("/api/candles", async (req, res) => {
  try {
    const { pair, from, to } = req.query;

    if (!pair || !/^[A-Z0-9_-]+$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid pair ID"
      });
    }

    const start = Number(from);
    const end = Number(to);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start <= 0 ||
      end <= start
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid from/to timestamps"
      });
    }

    const url =
      "https://public.coindcx.com/market_data/candlesticks?pair=" +
      encodeURIComponent(pair) +
      "&from=" + start +
      "&to=" + end +
      "&resolution=5&pcode=f";

    const raw = await getJSON(url);

    const candles = extractArray(raw, [
      "data",
      "candlesticks",
      "result"
    ]);

    if (!candles) {
      throw new Error("Unexpected candle response format");
    }

    res.json(candles);

  } catch (e) {
    console.error(
      `[CANDLES ERROR] ${req.query.pair || "UNKNOWN"}:`,
      e.message
    );

    res.status(502).json({
      success: false,
      pair: req.query.pair || null,
      error: e.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CoinDCX Scanner running on ${PORT}`);
});
