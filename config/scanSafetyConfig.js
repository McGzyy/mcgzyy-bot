const scanSafetyConfig = {
  /**
   * =========================
   * HARD REJECT
   * =========================
   * These are the "don't bother" rules.
   * If a token fails these, it should be ignored completely.
   */
  hardReject: {
    minLiquidity: 2000,
    minVolume5m: 300,
    minMarketCap: 3000,
    maxAgeMinutes: 2880 // 48h
  },

  /**
   * =========================
   * COOL DOWN REJECT
   * =========================
   * These are the "not good enough right now" rules.
   * Token may improve later, but not worth calling now.
   */
  cooldownReject: {
    minLiquidity: 5000,
    minVolume5m: 1000,
    minBuySellRatio5m: 0.9,
    maxAgeMinutes: 1440, // 24h
    retryMinutes: 30
  },

  /**
   * =========================
   * RISK WARNING FLAGS
   * =========================
   * These do NOT reject automatically.
   * They simply help label weak setups.
   */
  warningFlags: {
    lowLiquidity: 8000,
    weakVolume5m: 2500,
    weakBuyPressure: 1.0,
    agingOut: 180
  }
};

module.exports = { scanSafetyConfig };