const autoCallConfig = {
  enabled: true,
  defaultProfile: 'balanced',

  loop: {
    intervalMs: 60_000,
    maxCallsPerCycle: 2
  },

  alerts: {
    skipUnknownTokens: true
  },

  dedupe: {
    preventDuplicateCalls: true,
    cooldownMinutes: 180
  },

  debug: {
    enabled: true
  },

  failsafes: {
    emergencyStop: false
  },

  /**
   * =========================
   * 🚨 SANITY FILTERS
   * =========================
   */
  sanity: {
    // absurd pressure protection
    maxBuySellRatio5m: 8.0,
    maxBuySellRatio1h: 10.0,

    // liquidity / MC relationship
    maxLiquidityToMarketCapRatio: 0.90,
    minLiquidityToMarketCapRatio: 0.03,

    // volume sanity
    maxVolumeToLiquidityRatio5m: 5.0,
    maxVolumeToLiquidityRatio1h: 12.0,
    minUniqueVolumeToLiquidityRatio: 0.015,

    // minimum meaningful project floor
    minMeaningfulMarketCap: 15000,
    minMeaningfulLiquidity: 15000,

    // FaSol-inspired bot-call quality gates (only enforce when data is available)
    minAgeMinutes: 5,
    requireMigrated: true,
    minVolume5m: 10000,
    minVolume24h: 30000,
    minTrades24h: 1200,
    minBuys24h: 250,
    minHolders: 300
  },

  /**
   * =========================
   * 🧠 NAMING FILTERS
   * =========================
   */
  naming: {
    blockedTokenNames: [
      'anonymous',
      'unknown',
      'unknown token',
      'untitled',
      'unnamed',
      'null',
      'undefined',
      'test',
      'coin',
      'token'
    ],
    blockedTickers: [
      '???',
      'anonymous',
      'unknown',
      'null',
      'undefined',
      'test'
    ],
    minTokenNameLength: 3,
    minTickerLength: 2,
    maxTickerLength: 12
  },

  /**
   * =========================
   * ⚡ MOMENTUM FILTERS
   * =========================
   */
  momentum: {
    blockBearish: true,
    requirePositivePressure: false
  },

  /**
   * =========================
   * 🎯 PROFILE SETTINGS
   * =========================
   */
  profiles: {
    balanced: {
      minScore: 52,
      minLiquidity: 15000,
      minVolume5m: 10000,
      minBuySellRatio5m: 1.01, // loosened further
      maxAgeMinutes: 240,
      maxCallsPerHour: 8
    },

    aggressive: {
      minScore: 47,
      minLiquidity: 4500,
      minVolume5m: 1200,
      minBuySellRatio5m: 1.00,
      maxAgeMinutes: 300,
      maxCallsPerHour: 12
    },

    conservative: {
      minScore: 60,
      minLiquidity: 10000,
      minVolume5m: 3000,
      minBuySellRatio5m: 1.05,
      maxAgeMinutes: 180,
      maxCallsPerHour: 5
    }
  }
};

module.exports = {
  autoCallConfig
};