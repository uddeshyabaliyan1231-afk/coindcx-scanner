const express = require("express");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "CoinDCX-Scanner/2.0",
          "Accept": "application/json"
        }
      },
      (res) => {
        let data = "";

        res.on("data", chunk => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(
              new Error(
                `CoinDCX HTTP ${res.statusCode}: ${data.slice(0, 300)}`
              )
            );
          }

          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error("Invalid JSON response: " + error.message));
          }
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error("CoinDCX API timeout"));
    });

    request.on("error", reject);
  });
}

// Website files
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    scanner: "CoinDCX"
  });
});

// Get active USDT futures pairs
app.get("/api/pairs", async (req, res) => {
  try {
    console.log("[PAIRS] Request started");

    const url =
      "https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";

    const data = await getJSON(url);

    if (!Array.isArray(data)) {
      throw new Error("Unexpected instruments response format");
    }

    console.log(`[PAIRS] Received ${data.length} instruments`);

    res.json({
      success: true,
      count: data.length,
      pairs: data
    });

  } catch (error) {
    console.error("[PAIRS ERROR]", error.message);

    res.status(502).json({
      success: false,
      error: error.message
    });
  }
});

// Get 5-minute candles (scanner can aggregate into 15-minute candles)
app.get("/api/candles", async (req, res) => {
  try {
    const { pair, from, to } = req.query;

    // Allow letters, numbers, underscore and hyphen in pair IDs
    if (!pair || !/^[A-Z0-9_-]+$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid pair ID",
        receivedPair: pair || null
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

    console.log(`[CANDLES] Request: ${pair}`);

    const url =
      "https://public.coindcx.com/market_data/candlesticks?" +
      "pair=" + encodeURIComponent(pair) +
      "&from=" + start +
      "&to=" + end +
      "&resolution=5&pcode=f";

    const data = await getJSON(url);

    if (!Array.isArray(data)) {
      throw new Error("Unexpected candle response format");
    }

    console.log(`[CANDLES] ${pair}: received ${data.length} candles`);

    res.json(data);

  } catch (error) {
    console.error(
      `[CANDLES ERROR] ${req.query.pair || "UNKNOWN"}:`,
      error.message
    );

    res.status(502).json({
      success: false,
      pair: req.query.pair || null,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("CoinDCX Scanner Server Started");
  console.log("Port:", PORT);
  console.log("================================");
});
