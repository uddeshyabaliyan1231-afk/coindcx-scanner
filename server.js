
const express = require("express");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "CoinDCX-Supply-Scanner/1.0" }
    }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        if (res.statusCode !== 200)
          return reject(new Error("CoinDCX HTTP " + res.statusCode));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error("API timeout")));
    req.on("error", reject);
  });
}

function arr(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.data)) return x.data;
  if (x && Array.isArray(x.result)) return x.result;
  if (x && Array.isArray(x.instruments)) return x.instruments;
  return [];
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) =>
  res.json({ success: true, status: "online" })
);

app.get("/api/pairs", async (req, res) => {
  try {
    const url =
      "https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";
    const data = await getJSON(url);
    const pairs = arr(data);
    res.json({ success: true, pairs });
  } catch (e) {
    console.error("PAIR ERROR:", e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

app.get("/api/candles", async (req, res) => {
  try {
    const pair = String(req.query.pair || "");
    const interval = String(req.query.interval || "5");
    const allowed = ["5", "60", "1D"];

    if (!/^B-[A-Z0-9_-]+_USDT$/.test(pair))
      return res.status(400).json({ error: "Invalid pair" });

    if (!allowed.includes(interval))
      return res.status(400).json({ error: "Invalid interval" });

    const to = Math.floor(Date.now() / 1000);
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 220);
    const from = to - days * 86400;

    const url =
      "https://public.coindcx.com/market_data/candlesticks?pair=" +
      encodeURIComponent(pair) +
      "&from=" + from +
      "&to=" + to +
      "&resolution=" + interval +
      "&pcode=f";

    const data = await getJSON(url);
    const candles = arr(data);

    res.json({ success: true, candles });
  } catch (e) {
    console.error("CANDLE ERROR:", req.query.pair, e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () =>
  console.log("Supply Zone Scanner running on port " + PORT)
);
