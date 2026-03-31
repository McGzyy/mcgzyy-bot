const axios = require('axios');

function getBestPair(pairs = []) {
  if (!pairs.length) return null;

  return pairs.sort((a, b) => {
    const liqA = Number(a?.liquidity?.usd || 0);
    const liqB = Number(b?.liquidity?.usd || 0);

    const volA = Number(a?.volume?.h24 || 0);
    const volB = Number(b?.volume?.h24 || 0);

    const scoreA = liqA + (volA * 0.35);
    const scoreB = liqB + (volB * 0.35);

    return scoreB - scoreA;
  })[0];
}

async function fetchTokenIntelligence(contractAddress) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
    const response = await axios.get(url);

    const pairs = response.data?.pairs || [];

    if (!pairs.length) {
      return {
        devHoldingPercent: null,
        bundleHoldingPercent: null,
        top10HolderPercent: null,
        holders: null,

        mintRisk: 'Unknown',
        freezeRisk: 'Unknown',
        liquidityLockStatus: 'Unknown',
        tokenSecurityScore: null,

        concentrationRisk: 'Unknown',
        deployerRisk: 'Unknown',
        bundleRisk: 'Unknown',

        source: 'dexscreener-empty'
      };
    }

    const bestPair = getBestPair(pairs);

    if (!bestPair) {
      return {
        devHoldingPercent: null,
        bundleHoldingPercent: null,
        top10HolderPercent: null,
        holders: null,

        mintRisk: 'Unknown',
        freezeRisk: 'Unknown',
        liquidityLockStatus: 'Unknown',
        tokenSecurityScore: null,

        concentrationRisk: 'Unknown',
        deployerRisk: 'Unknown',
        bundleRisk: 'Unknown',

        source: 'dexscreener-no-best-pair'
      };
    }

    const liquidity = Number(bestPair?.liquidity?.usd || 0);
    const marketCap = Number(bestPair?.marketCap || 0);
    const volume5m = Number(bestPair?.volume?.m5 || 0);
    const volume24h = Number(bestPair?.volume?.h24 || 0);
    const txns5m = Number(
      (bestPair?.txns?.m5?.buys || 0) + (bestPair?.txns?.m5?.sells || 0)
    );
    const txns24h = Number(
      (bestPair?.txns?.h24?.buys || 0) + (bestPair?.txns?.h24?.sells || 0)
    );

    let concentrationRisk = 'Unknown';
    let tokenSecurityScore = 50;
    let mintRisk = 'Unknown';
    let freezeRisk = 'Unknown';
    let liquidityLockStatus = 'Unknown';
    let deployerRisk = 'Unknown';
    let bundleRisk = 'Unknown';

    const liqRatio = marketCap > 0 ? liquidity / marketCap : 0;
    const activityRatio = liquidity > 0 ? volume24h / liquidity : 0;

    // ----------------------------
    // CONCENTRATION / STRUCTURE
    // ----------------------------
    if (liqRatio <= 0.05) {
      concentrationRisk = 'High';
      tokenSecurityScore -= 14;
    } else if (liqRatio <= 0.10) {
      concentrationRisk = 'Moderate';
      tokenSecurityScore -= 8;
    } else if (liqRatio <= 0.18) {
      concentrationRisk = 'Watch';
      tokenSecurityScore -= 3;
    } else {
      concentrationRisk = 'Lower';
      tokenSecurityScore += 6;
    }

    // ----------------------------
    // DEPLOYER / BUNDLE-ISH RISK
    // ----------------------------
    if (marketCap < 12000 && liquidity < 4500) {
      deployerRisk = 'High';
      tokenSecurityScore -= 10;
    } else if (marketCap < 20000 && liquidity < 7000) {
      deployerRisk = 'Moderate';
      tokenSecurityScore -= 5;
    } else {
      deployerRisk = 'Lower';
      tokenSecurityScore += 2;
    }

    if (volume5m > 25000 && liquidity < 7000) {
      bundleRisk = 'High';
      tokenSecurityScore -= 12;
    } else if (volume5m > 12000 && liquidity < 9000) {
      bundleRisk = 'Moderate';
      tokenSecurityScore -= 6;
    } else if (txns5m >= 20 && liquidity < 8000) {
      bundleRisk = 'Watch';
      tokenSecurityScore -= 4;
    } else {
      bundleRisk = 'Lower';
      tokenSecurityScore += 2;
    }

    // ----------------------------
    // ACTIVITY QUALITY
    // ----------------------------
    if (activityRatio > 5 && txns24h > 200) {
      tokenSecurityScore += 6;
    } else if (activityRatio < 0.5 && txns24h < 40) {
      tokenSecurityScore -= 6;
    }

    // ----------------------------
    // LIQUIDITY HEALTH
    // ----------------------------
    if (liquidity < 3000) {
      tokenSecurityScore -= 10;
    } else if (liquidity < 7000) {
      tokenSecurityScore -= 5;
    } else if (liquidity > 20000) {
      tokenSecurityScore += 5;
    }

    // ----------------------------
    // PLACEHOLDER FIELDS (future API-ready)
    // ----------------------------
    // These remain null until we connect a real holder / security source
    const devHoldingPercent = null;
    const bundleHoldingPercent = null;
    const top10HolderPercent = null;
    const holders = null;

    tokenSecurityScore = Math.max(0, Math.min(100, tokenSecurityScore));

    return {
      devHoldingPercent,
      bundleHoldingPercent,
      top10HolderPercent,
      holders,

      mintRisk,
      freezeRisk,
      liquidityLockStatus,
      tokenSecurityScore,

      concentrationRisk,
      deployerRisk,
      bundleRisk,

      source: 'dexscreener-heuristic-v2'
    };
  } catch (error) {
    console.error('[TokenIntelligenceProvider] Error:', error.message);

    return {
      devHoldingPercent: null,
      bundleHoldingPercent: null,
      top10HolderPercent: null,
      holders: null,

      mintRisk: 'Unknown',
      freezeRisk: 'Unknown',
      liquidityLockStatus: 'Unknown',
      tokenSecurityScore: null,

      concentrationRisk: 'Unknown',
      deployerRisk: 'Unknown',
      bundleRisk: 'Unknown',

      source: 'error'
    };
  }
}

module.exports = { fetchTokenIntelligence };