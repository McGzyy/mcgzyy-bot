function getFakeTokenData(contractAddress = null) {
  const tokens = [
    {
      name: 'BrainMeme',
      ticker: 'BRAIN',
      contractAddress: '7Hk9...BRAIN',
      website: 'https://brainmeme.xyz',
      twitter: 'https://x.com/brainmeme',
      telegram: 'https://t.me/brainmeme'
    },
    {
      name: 'AgentPepe',
      ticker: 'AGENT',
      contractAddress: '9Lp2...AGENT',
      website: 'https://agentpepe.ai',
      twitter: 'https://x.com/agentpepe',
      telegram: 'https://t.me/agentpepe'
    },
    {
      name: 'NeuroCat',
      ticker: 'NCAT',
      contractAddress: '4Zm8...NCAT',
      website: 'https://neurocat.io',
      twitter: 'https://x.com/neurocat',
      telegram: 'https://t.me/neurocat'
    },
    {
      name: 'QuantumFrog',
      ticker: 'QFROG',
      contractAddress: '3Qa1...QFROG',
      website: 'https://quantumfrog.fun',
      twitter: 'https://x.com/quantumfrog',
      telegram: 'https://t.me/quantumfrog'
    },
    {
      name: 'AlphaBot',
      ticker: 'ALPHA',
      contractAddress: '8Tx5...ALPHA',
      website: 'https://alphabot.tech',
      twitter: 'https://x.com/alphabot',
      telegram: 'https://t.me/alphabot'
    }
  ];

  const narratives = [
    'AI + Meme',
    'AI Agents',
    'Meme Momentum',
    'Utility + AI',
    'Social Hype'
  ];

  const narrativeSummaries = [
    'An AI-themed meme coin leaning into terminal / agent culture and speculative hype.',
    'A community-driven meme project built around AI agent branding and fast social momentum.',
    'A narrative-heavy meme coin using futuristic branding and early wallet attention.',
    'A hype-driven launch combining meme culture, social posting, and AI-related buzz.',
    'A speculative low-cap token pushing an AI / utility identity with meme appeal.'
  ];

  const walletActivity = [
    'Fresh wallets entering',
    'Smart money watching',
    'Repeat buyers spotted',
    'Whale-sized test entries',
    'Cluster wallet activity'
  ];

  const momentumLevels = ['Low', 'Building', 'Strong', 'Very Strong'];
  const launchPlatforms = ['Pump.fun', 'Moonshot', 'Fair Launch', 'Unknown'];
  const brandingQualities = ['Weak', 'Average', 'Strong'];
  const socialQualities = ['Weak', 'Average', 'Strong'];

  const randomToken = tokens[Math.floor(Math.random() * tokens.length)];
  const randomNarrative = narratives[Math.floor(Math.random() * narratives.length)];
  const randomNarrativeSummary = narrativeSummaries[Math.floor(Math.random() * narrativeSummaries.length)];
  const randomWallet = walletActivity[Math.floor(Math.random() * walletActivity.length)];
  const randomMomentum = momentumLevels[Math.floor(Math.random() * momentumLevels.length)];
  const randomLaunchPlatform = launchPlatforms[Math.floor(Math.random() * launchPlatforms.length)];
  const randomBrandingQuality = brandingQualities[Math.floor(Math.random() * brandingQualities.length)];
  const randomSocialQuality = socialQualities[Math.floor(Math.random() * socialQualities.length)];

  const marketCap = Math.floor(Math.random() * 450000) + 50000;
  const ath = marketCap + Math.floor(Math.random() * 1500000) + 100000;
  const percentFromAth = Math.floor(((ath - marketCap) / ath) * 100);

  const ageMinutes = Math.floor(Math.random() * 720) + 5;
  const volume5m = Math.floor(Math.random() * 50000) + 1000;
  const liquidity = Math.floor(Math.random() * 100000) + 5000;
  const holders = Math.floor(Math.random() * 2500) + 50;

  const snipers = Math.floor(Math.random() * 15);
  const devHoldingPercent = parseFloat((Math.random() * 8).toFixed(2));
  const smartWallets = Math.floor(Math.random() * 12);
  const freshWallets = Math.floor(Math.random() * 25);

  const xMentions = Math.floor(Math.random() * 80);
  const websiteLive = Math.random() > 0.15;
  const dexPaid = Math.random() > 0.5;

  return {
    token: {
      tokenName: randomToken.name,
      ticker: randomToken.ticker,
      contractAddress: contractAddress || randomToken.contractAddress,
      website: randomToken.website,
      twitter: randomToken.twitter,
      telegram: randomToken.telegram,
      narrative: randomNarrative,
      narrativeSummary: randomNarrativeSummary,
      launchPlatform: randomLaunchPlatform,
      brandingQuality: randomBrandingQuality
    },

    market: {
      marketCap,
      ath,
      percentFromAth,
      ageMinutes,
      volume5m,
      liquidity,
      holders,
      momentum: randomMomentum
    },

    wallets: {
      walletActivity: randomWallet,
      snipers,
      devHoldingPercent,
      smartWallets,
      freshWallets
    },

    socials: {
      xMentions,
      socialQuality: randomSocialQuality,
      websiteLive,
      dexPaid
    }
  };
}

module.exports = { getFakeTokenData };