const scannerConfig = {
  /**
   * =========================
   * CORE SCORING
   * =========================
   */
  scoring: {
    baseScore: 50,

    liquidity: {
      strong: { threshold: 50000, bonus: 15 },
      decent: { threshold: 20000, bonus: 10 },
      weak: { threshold: 5000, penalty: -10 }
    },

    volume5m: {
      strong: { threshold: 20000, bonus: 15 },
      decent: { threshold: 10000, bonus: 10 },
      weak: { threshold: 2000, penalty: -10 }
    },

    marketCap: {
      sweetSpotMin: 50000,
      sweetSpotMax: 500000,
      sweetSpotBonus: 10,
      tooLowPenalty: -10
    },

    age: {
      earlyBonus: { maxMinutes: 30, bonus: 10 },
      stalePenalty: { minMinutes: 300, penalty: -10 }
    },

    buyPressure: {
      veryBullish: { threshold: 1.8, bonus: 12 },
      bullish: { threshold: 1.25, bonus: 8 },
      bearish: { threshold: 0.8, penalty: -10 }
    },

    tradePressure: {
      veryBullish: 8,
      bullish: 5,
      bearish: -8
    },

    volumeTrend: {
      veryStrong: 8,
      strong: 5,
      weak: -5
    },

    socials: {
      website: 5,
      twitter: 5,
      telegram: 5,
      dexPaid: 5
    },

    misc: {
      migrated: 3
    }
  },

  /**
   * =========================
   * GRADING SYSTEM
   * =========================
   */
  grading: {
    thresholds: {
      A: 85,
      B: 70,
      C: 55,
      D: 40
    },

    labels: {
      A: 'Strong Candidate',
      B: 'Good Watch / Possible Entry',
      C: 'Watchlist',
      D: 'Risky',
      F: 'Avoid'
    }
  },

  /**
   * =========================
   * ALERT TYPE LABELS
   * =========================
   */
  alertTypes: {
    strong: {
      minScore: 80,
      label: '🔥 Strong Setup'
    },
    moderate: {
      minScore: 65,
      label: '⚡ Moderate Setup'
    },
    watchlist: {
      minScore: 50,
      label: '📡 Watchlist'
    },
    risky: {
      label: '⚠️ Risky'
    }
  },

  /**
   * =========================
   * MOMENTUM SYSTEM
   * =========================
   */
  momentum: {
    volume: {
      high: 15000,
      medium: 7000,
      low: 3000
    },

    buyPressure: {
      veryStrong: 1.8,
      strong: 1.2,
      weak: 0.8
    },

    priceChange5m: {
      strong: 12,
      moderate: 5,
      negative: -10
    }
  },

  /**
   * =========================
   * RISK SYSTEM
   * =========================
   */
  risk: {
    liquidity: {
      highRisk: 5000,
      moderateRisk: 10000
    },

    buyPressure: {
      danger: 0.8,
      weak: 1.0
    },

    age: {
      stale: 180
    }
  },

  /**
   * =========================
   * TRADE QUALITY
   * =========================
   */
  tradeQuality: {
    high: {
      minRatio: 1.8,
      minVolume: 10000
    },
    good: {
      minRatio: 1.2,
      minVolume: 5000
    },
    lowVolume: 2000
  }
};

module.exports = { scannerConfig };