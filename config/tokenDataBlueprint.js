const tokenDataBlueprint = {
  token: {
    tokenName: null,
    ticker: null,
    contractAddress: null,
    website: null,
    twitter: null,
    telegram: null,
    narrative: null,
    narrativeSummary: null,
    launchPlatform: null,
    brandingQuality: null
  },

  market: {
    marketCap: null,
    ath: null,
    percentFromAth: null,
    ageMinutes: null,
    volume5m: null,
    liquidity: null,
    holders: null,
    momentum: null
  },

  wallets: {
    walletActivity: null,
    snipers: null,
    devHoldingPercent: null,
    smartWallets: null,
    freshWallets: null
  },

  socials: {
    xMentions: null,
    socialQuality: null,
    websiteLive: null,
    dexPaid: null
  }
};

module.exports = { tokenDataBlueprint };