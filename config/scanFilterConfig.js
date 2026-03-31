const scanFilterConfig = {
  autoCall: {
    balanced: {
      minMarketCap: 15000,
      maxMarketCap: 350000,
      minLiquidity: 5000,
      minVolume5m: 1500,
      minVolume1h: 4000,
      minBuySellRatio5m: 1.02, // loosened further
      maxAgeMinutes: 240,
      minScore: 50
    },

    aggressive: {
      minMarketCap: 12000,
      maxMarketCap: 450000,
      minLiquidity: 4000,
      minVolume5m: 1000,
      minVolume1h: 3000,
      minBuySellRatio5m: 1.00,
      maxAgeMinutes: 300,
      minScore: 45
    },

    conservative: {
      minMarketCap: 20000,
      maxMarketCap: 250000,
      minLiquidity: 8000,
      minVolume5m: 2500,
      minVolume1h: 6000,
      minBuySellRatio5m: 1.05,
      maxAgeMinutes: 180,
      minScore: 58
    }
  }
};

module.exports = {
  scanFilterConfig
};