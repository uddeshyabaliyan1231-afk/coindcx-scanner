const express = require("express");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// CoinDCX API request
function getJSON(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "CoinDCX-Scanner/3.0",
          "Accept": "application/json"
        }
      },
      (response) => {
        let body = "";

        response.on("data", chunk => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode !== 200) {
            return reject(
              new Error(
                `CoinDCX HTTP ${response.statusCode}: ${body.slice(0, 500)}`
              )
            );
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error("Invalid JSON: " + error.message));
          }
        });
      }
    );

    request.setTimeout(20000, () => {
      request.destroy(new Error("CoinDCX API timeout"));
    });

    request.on("error", reject);
  });
}

// Website
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

    const instruments = await getJSON(url);

    if (!Array.isArray(instruments)) {
      throw new Error(
        "Invalid instruments response: " +
        JSON.stringify(instruments).slice(0, 500)
      );
    }

    console.log(`[PAIRS] Received ${instruments.length} instruments`);

    res.json({
      success: true,
      count: instruments.length,
      pairs: instruments
    });

  } catch (error) {
    console.error("[PAIRS ERROR]", error.message);

    res.status(502).json({
      success: false,
      error: error.message
    });
  }
});

// Get 5-minute candles
app.get("/api/candles", async (req, res) => {
  try {
    const { pair, from, to } = req.query;

    if (!pair || !/^[A-Z0-9_-]+$/.test(pair)) {
      return res.status(400).json({
        success: false,
        error: "Invalid pair ID",
        pair: pair || null
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
        error: "Invalid timestamps"
      });
    }

    console.log(`[CANDLES] Request: ${pair}`);

    const url =
      "https://public.coindcx.com/market_data/candlesticks?" +
      "pair=" + encodeURIComponent(pair) +
      "&from=" + start +
      "&to=" + end +
      "&resolution=5&pcode=f";

    const response = await getJSON(url);

    // CoinDCX response: { s: "ok", data: [...] }
    const candles = Array.isArray(response)
      ? response
      : (
          response &&
          response.s === "ok" &&
          Array.isArray(response.data)
        )
        ? response.data
        : null;

    if (!candles) {
      throw new Error(
        "Invalid CoinDCX candle response: " +
        JSON.stringify(response).slice(0, 500)
      );
    }

    console.log(
      `[CANDLES] ${pair}: received ${candles.length} candles`
    );

    // Send candle array to scanner
    res.json(candles);

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
