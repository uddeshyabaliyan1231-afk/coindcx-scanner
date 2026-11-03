const express = require("express");
const https = require("https");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "CoinDCX-Scanner/1.0" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error("CoinDCX HTTP " + res.statusCode));
          }
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/pairs", async (req, res) => {
  try {
    const url = "https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT";
    const data = await getJSON(url);
    res.json({ success: true, pairs: data });
  } catch (e) {
    res.status(502).json({ success: false, error: e.message });
  }
});

app.get("/api/candles", async (req, res) => {
  try {
    const { pair, from, to } = req.query;
    if (!pair || !/^[A-Z0-9_]+$/.test(pair)) {
      return res.status(400).json({ error: "Invalid pair" });
    }
    const url = "https://public.coindcx.com/market_data/candlesticks?pair=" +
      encodeURIComponent(pair) + "&from=" + Number(from) +
      "&to=" + Number(to) + "&resolution=5&pcode=f";
    const data = await getJSON(url);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, "0.0.0.0", () => console.log("Scanner running on " + PORT));
