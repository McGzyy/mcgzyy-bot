const axios = require('axios');
const { chromium } = require('playwright');

let browserInstance = null;

async function getBrowser() {
  if (browserInstance) return browserInstance;

  browserInstance = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  return browserInstance;
}

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

function emptyHolderIntelligence(source = 'empty') {
  return {
    holders: null,
    top10HolderPercent: null,
    devHoldingPercent: null,
    bundleHoldingPercent: null,
    sniperPercent: null,

    smartWallets: null,
    freshWallets: null,
    snipers: null,
    walletQuality: 'Unknown',
    concentrationRisk: 'Unknown',
    walletClusterRisk: 'Unknown',
    insiderRisk: 'Unknown',

    source
  };
}

function logHolderDebug(stage, payload) {
  console.log(`\n[HOLDER DEBUG] ${stage}`);
  console.log(JSON.stringify(payload, null, 2));
}

function pickBetterValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function parsePercent(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  const str = String(value).trim();
  if (!str) return null;

  const cleaned = str.replace('%', '').replace(/,/g, '').trim();
  const num = Number(cleaned);

  return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function buildHolderResult({
  holders = null,
  top10HolderPercent = null,
  devHoldingPercent = null,
  bundleHoldingPercent = null,
  sniperPercent = null,
  source = 'unknown'
} = {}) {
  return {
    holders: holders !== null && holders !== undefined ? parseNumber(holders) : null,
    top10HolderPercent: parsePercent(top10HolderPercent),
    devHoldingPercent: parsePercent(devHoldingPercent),
    bundleHoldingPercent: parsePercent(bundleHoldingPercent),
    sniperPercent: parsePercent(sniperPercent),

    smartWallets: null,
    freshWallets: null,
    snipers: null,
    walletQuality: 'Unknown',
    concentrationRisk: 'Unknown',
    walletClusterRisk: 'Unknown',
    insiderRisk: 'Unknown',

    source
  };
}

function hasHighSignal(result) {
  return (
    result?.top10HolderPercent !== null ||
    result?.devHoldingPercent !== null ||
    result?.bundleHoldingPercent !== null ||
    result?.sniperPercent !== null
  );
}

/**
 * CLEANER GMGN EXTRACTION:
 * ONLY accept % values inside the likely holder section.
 */
function extractMetricsFromText(text) {
  if (!text) return null;

  const holderSectionMatch = text.match(/Holders[\s\S]{0,1200}/i);
  const section = holderSectionMatch ? holderSectionMatch[0] : text;

  function extractPercent(labelRegex) {
    const regex = new RegExp(`${labelRegex}[^%]{0,40}([0-9]+(?:\\.[0-9]+)?)\\s*%`, 'i');
    const match = section.match(regex);
    return match ? match[1] : null;
  }

  function extractHolders() {
    const patterns = [
      /Holders[^0-9]{0,10}([0-9,]+)/i,
      /Holder\s*Count[^0-9]{0,10}([0-9,]+)/i
    ];

    for (const regex of patterns) {
      const match = section.match(regex);
      if (match?.[1]) return match[1];
    }

    return null;
  }

  const result = buildHolderResult({
    holders: extractHolders(),
    top10HolderPercent: extractPercent('top\\s*10|top10'),
    devHoldingPercent: extractPercent('dev|developer|creator|deployer'),
    bundleHoldingPercent: extractPercent('bundle|bundled'),
    sniperPercent: extractPercent('sniper|snipers'),
    source: 'gmgn-playwright-clean'
  });

  if (
    (result.devHoldingPercent !== null && result.devHoldingPercent > 100) ||
    (result.top10HolderPercent !== null && result.top10HolderPercent > 100) ||
    (result.bundleHoldingPercent !== null && result.bundleHoldingPercent > 100) ||
    (result.sniperPercent !== null && result.sniperPercent > 100)
  ) {
    logHolderDebug('GMGN CLEAN EXTRACT REJECTED IMPOSSIBLE VALUES', {
      result
    });
    return null;
  }

  return hasHighSignal(result) || result.holders !== null ? result : null;
}

// -----------------------------------
// GMGN PLAYWRIGHT SOURCE (PRIMARY)
// -----------------------------------
async function fetchGmgnHolderData(contractAddress) {
  let page = null;

  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US'
    });

    page = await context.newPage();

    const targetUrl = `https://gmgn.ai/sol/token/${contractAddress}`;

    logHolderDebug('GMGN PLAYWRIGHT START', {
      contractAddress,
      targetUrl
    });

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(7000);

    const title = await page.title().catch(() => null);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const html = await page.content().catch(() => '');

    logHolderDebug('GMGN PLAYWRIGHT PAGE SNAPSHOT', {
      contractAddress,
      title,
      bodyTextPreview: bodyText?.slice(0, 1600) || '',
      htmlLength: html?.length || 0
    });

    const resultFromText = extractMetricsFromText(bodyText || '');
    if (resultFromText) {
      logHolderDebug('GMGN PLAYWRIGHT TEXT SUCCESS', {
        contractAddress,
        extracted: resultFromText
      });

      await context.close();
      return resultFromText;
    }

    const resultFromHtml = extractMetricsFromText(html || '');
    if (resultFromHtml) {
      logHolderDebug('GMGN PLAYWRIGHT HTML SUCCESS', {
        contractAddress,
        extracted: resultFromHtml
      });

      await context.close();
      return resultFromHtml;
    }

    logHolderDebug('GMGN PLAYWRIGHT NO EXTRACTABLE SIGNAL', {
      contractAddress
    });

    await context.close();
    return null;
  } catch (error) {
    logHolderDebug('GMGN PLAYWRIGHT FAILED', {
      contractAddress,
      error: error.message
    });

    if (page) {
      try {
        await page.context().close();
      } catch {}
    }

    return null;
  }
}

// -----------------------------------
// BIRDEYE FALLBACK (SECONDARY)
// -----------------------------------
async function fetchBirdeyeMarketData(contractAddress, apiKey) {
  try {
    const response = await axios.get(
      `https://public-api.birdeye.so/defi/v3/token/market-data?address=${contractAddress}`,
      {
        headers: {
          'X-API-KEY': apiKey,
          'x-chain': 'solana'
        }
      }
    );

    const data = response.data?.data;
    if (!data) {
      logHolderDebug('Birdeye Market Data - No Data', { contractAddress });
      return null;
    }

    return {
      holders: Number(data?.holder || 0) || null,
      source: 'birdeye-market-data'
    };
  } catch (error) {
    console.error('[HolderIntelligenceProvider] Birdeye market-data error:', error.message);
    logHolderDebug('Birdeye Market Data Error', {
      contractAddress,
      error: error.message
    });
    return null;
  }
}

async function fetchBirdeyeHolderList(contractAddress, apiKey) {
  try {
    const response = await axios.get(
      `https://public-api.birdeye.so/defi/v3/token/holder?address=${contractAddress}`,
      {
        headers: {
          'X-API-KEY': apiKey,
          'x-chain': 'solana'
        }
      }
    );

    const data = response.data?.data;
    if (!data || !Array.isArray(data.items) || !data.items.length) {
      logHolderDebug('Birdeye Holder List - Empty', {
        contractAddress,
        hasData: !!data,
        hasItems: !!data?.items,
        itemCount: data?.items?.length || 0
      });
      return null;
    }

    const holdersList = data.items;

    const totalVisibleSupply = holdersList.reduce((sum, holder) => {
      return sum + Number(holder?.ui_amount || 0);
    }, 0);

    let top10HolderPercent = null;
    let devHoldingPercent = null;

    if (totalVisibleSupply > 0) {
      const top10Supply = holdersList.slice(0, 10).reduce((sum, holder) => {
        return sum + Number(holder?.ui_amount || 0);
      }, 0);

      top10HolderPercent = Number(((top10Supply / totalVisibleSupply) * 100).toFixed(2));

      const topHolderSupply = Number(holdersList?.[0]?.ui_amount || 0);
      devHoldingPercent = Number(((topHolderSupply / totalVisibleSupply) * 100).toFixed(2));
    }

    logHolderDebug('Birdeye Holder List Result', {
      contractAddress,
      top10HolderPercent,
      devHoldingPercent,
      totalVisibleSupply,
      holderCountSeen: holdersList.length
    });

    return {
      top10HolderPercent,
      devHoldingPercent,
      source: 'birdeye-holder-list'
    };
  } catch (error) {
    console.error('[HolderIntelligenceProvider] Birdeye holder-list error:', error.message);
    logHolderDebug('Birdeye Holder List Error', {
      contractAddress,
      error: error.message
    });
    return null;
  }
}

async function fetchBirdeyeHolderData(contractAddress) {
  try {
    const apiKey = process.env.BIRDEYE_API_KEY;

    if (!apiKey) {
      logHolderDebug('Birdeye Fallback - Missing API Key', { contractAddress });
      return null;
    }

    const [marketData, holderListData] = await Promise.all([
      fetchBirdeyeMarketData(contractAddress, apiKey),
      fetchBirdeyeHolderList(contractAddress, apiKey)
    ]);

    const result = {
      holders: marketData?.holders ?? null,
      top10HolderPercent: holderListData?.top10HolderPercent ?? null,
      devHoldingPercent: holderListData?.devHoldingPercent ?? null,
      bundleHoldingPercent: null,
      sniperPercent: null,

      smartWallets: null,
      freshWallets: null,
      snipers: null,
      walletQuality: 'Unknown',
      concentrationRisk: 'Unknown',
      walletClusterRisk: 'Unknown',
      insiderRisk: 'Unknown',

      source: 'birdeye-live'
    };

    logHolderDebug('Birdeye Fallback Result', {
      contractAddress,
      result
    });

    return result;
  } catch (error) {
    console.error('[HolderIntelligenceProvider] Birdeye fallback error:', error.message);
    logHolderDebug('Birdeye Fallback Error', {
      contractAddress,
      error: error.message
    });
    return null;
  }
}

// -----------------------------------
// HEURISTIC FALLBACK (LAST RESORT)
// -----------------------------------
function buildHeuristicSignalData(bestPair) {
  const liquidity = Number(bestPair?.liquidity?.usd || 0);
  const marketCap = Number(bestPair?.marketCap || 0);
  const volume5m = Number(bestPair?.volume?.m5 || 0);
  const volume24h = Number(bestPair?.volume?.h24 || 0);

  const buys5m = Number(bestPair?.txns?.m5?.buys || 0);
  const sells5m = Number(bestPair?.txns?.m5?.sells || 0);
  const buys24h = Number(bestPair?.txns?.h24?.buys || 0);
  const sells24h = Number(bestPair?.txns?.h24?.sells || 0);

  const txns5m = buys5m + sells5m;
  const txns24h = buys24h + sells24h;

  const liqRatio = marketCap > 0 ? liquidity / marketCap : 0;
  const buyPressure5m = txns5m > 0 ? buys5m / txns5m : 0;
  const activityDensity = liquidity > 0 ? volume24h / liquidity : 0;

  let smartWallets = 0;
  let freshWallets = 0;
  let sniperPercent = null;
  let snipers = 0;
  let walletQuality = 'Unknown';
  let concentrationRisk = 'Unknown';
  let walletClusterRisk = 'Unknown';
  let insiderRisk = 'Unknown';
  let bundleHoldingPercent = null;

  if (txns5m >= 18 && buyPressure5m >= 0.60) freshWallets += 6;
  else if (txns5m >= 10 && buyPressure5m >= 0.55) freshWallets += 4;
  else if (txns5m >= 5 && buyPressure5m >= 0.50) freshWallets += 2;

  if (volume5m >= 12000) freshWallets += 2;

  if (liqRatio >= 0.15 && volume24h >= 25000 && txns24h >= 80) smartWallets += 4;
  else if (liqRatio >= 0.10 && volume24h >= 12000 && txns24h >= 40) smartWallets += 2;

  if (buyPressure5m >= 0.65 && volume5m >= 15000) smartWallets += 2;

  if (txns5m >= 20 && liquidity < 7000) snipers += 6;
  else if (txns5m >= 12 && liquidity < 9000) snipers += 4;
  else if (txns5m >= 8 && liquidity < 12000) snipers += 2;

  if (buyPressure5m >= 0.75 && volume5m >= 10000) snipers += 2;

  if (smartWallets >= 5 && snipers <= 3) walletQuality = 'Strong';
  else if (smartWallets >= 2 || freshWallets >= 4) walletQuality = 'Moderate';
  else walletQuality = 'Weak';

  if (liqRatio <= 0.05 && txns24h < 40) concentrationRisk = 'High';
  else if (liqRatio <= 0.10) concentrationRisk = 'Moderate';
  else if (activityDensity >= 3 && txns24h >= 80) concentrationRisk = 'Lower';
  else concentrationRisk = 'Watch';

  if (buyPressure5m >= 0.75 && txns5m >= 15 && liquidity < 8000) {
    walletClusterRisk = 'High';
    insiderRisk = 'Watch';
  } else if (buyPressure5m >= 0.65 && txns5m >= 10) {
    walletClusterRisk = 'Moderate';
    insiderRisk = 'Watch';
  } else {
    walletClusterRisk = 'Lower';
    insiderRisk = 'Lower';
  }

  if (txns24h > 0) {
    sniperPercent = Number(Math.min((snipers / Math.max(txns24h, 1)) * 100, 100).toFixed(2));
  }

  if (buyPressure5m >= 0.75 && txns5m >= 12) bundleHoldingPercent = 12;
  else if (buyPressure5m >= 0.65 && txns5m >= 8) bundleHoldingPercent = 7;
  else if (buyPressure5m >= 0.55 && txns5m >= 5) bundleHoldingPercent = 3;
  else bundleHoldingPercent = 0;

  return {
    holders: null,
    top10HolderPercent: null,
    devHoldingPercent: null,
    bundleHoldingPercent,
    sniperPercent,

    smartWallets,
    freshWallets,
    snipers,
    walletQuality,
    concentrationRisk,
    walletClusterRisk,
    insiderRisk,

    source: 'heuristic-v5'
  };
}

// -----------------------------------
// MAIN PROVIDER
// -----------------------------------
async function fetchHolderIntelligence(contractAddress) {
  try {
    const gmgnData = await fetchGmgnHolderData(contractAddress);
    const birdeyeData = await fetchBirdeyeHolderData(contractAddress);

    const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
    const response = await axios.get(url);

    const pairs = response.data?.pairs || [];
    if (!pairs.length) {
      const result = {
        ...emptyHolderIntelligence('no-pairs'),
        holders: pickBetterValue(gmgnData?.holders, birdeyeData?.holders),
        top10HolderPercent: pickBetterValue(gmgnData?.top10HolderPercent, birdeyeData?.top10HolderPercent),
        devHoldingPercent: pickBetterValue(gmgnData?.devHoldingPercent, birdeyeData?.devHoldingPercent),
        bundleHoldingPercent: pickBetterValue(gmgnData?.bundleHoldingPercent, birdeyeData?.bundleHoldingPercent),
        sniperPercent: pickBetterValue(gmgnData?.sniperPercent, birdeyeData?.sniperPercent),
        source: gmgnData?.source || birdeyeData?.source || 'no-pairs'
      };

      logHolderDebug('FINAL HOLDER INTELLIGENCE RETURN (NO PAIRS)', {
        contractAddress,
        result
      });

      return result;
    }

    const bestPair = getBestPair(pairs);
    if (!bestPair) {
      const result = {
        ...emptyHolderIntelligence('no-best-pair'),
        holders: pickBetterValue(gmgnData?.holders, birdeyeData?.holders),
        top10HolderPercent: pickBetterValue(gmgnData?.top10HolderPercent, birdeyeData?.top10HolderPercent),
        devHoldingPercent: pickBetterValue(gmgnData?.devHoldingPercent, birdeyeData?.devHoldingPercent),
        bundleHoldingPercent: pickBetterValue(gmgnData?.bundleHoldingPercent, birdeyeData?.bundleHoldingPercent),
        sniperPercent: pickBetterValue(gmgnData?.sniperPercent, birdeyeData?.sniperPercent),
        source: gmgnData?.source || birdeyeData?.source || 'no-best-pair'
      };

      logHolderDebug('FINAL HOLDER INTELLIGENCE RETURN (NO BEST PAIR)', {
        contractAddress,
        result
      });

      return result;
    }

    const heuristicData = buildHeuristicSignalData(bestPair);

    const finalResult = {
      holders: pickBetterValue(gmgnData?.holders, birdeyeData?.holders, heuristicData?.holders),
      top10HolderPercent: pickBetterValue(gmgnData?.top10HolderPercent, birdeyeData?.top10HolderPercent, heuristicData?.top10HolderPercent),
      devHoldingPercent: pickBetterValue(gmgnData?.devHoldingPercent, birdeyeData?.devHoldingPercent, heuristicData?.devHoldingPercent),
      bundleHoldingPercent: pickBetterValue(gmgnData?.bundleHoldingPercent, birdeyeData?.bundleHoldingPercent, heuristicData?.bundleHoldingPercent),
      sniperPercent: pickBetterValue(gmgnData?.sniperPercent, birdeyeData?.sniperPercent, heuristicData?.sniperPercent),

      smartWallets: pickBetterValue(gmgnData?.smartWallets, birdeyeData?.smartWallets, heuristicData?.smartWallets),
      freshWallets: pickBetterValue(gmgnData?.freshWallets, birdeyeData?.freshWallets, heuristicData?.freshWallets),
      snipers: pickBetterValue(gmgnData?.snipers, birdeyeData?.snipers, heuristicData?.snipers),
      walletQuality: pickBetterValue(gmgnData?.walletQuality, birdeyeData?.walletQuality, heuristicData?.walletQuality),
      concentrationRisk: pickBetterValue(gmgnData?.concentrationRisk, birdeyeData?.concentrationRisk, heuristicData?.concentrationRisk),
      walletClusterRisk: pickBetterValue(gmgnData?.walletClusterRisk, birdeyeData?.walletClusterRisk, heuristicData?.walletClusterRisk),
      insiderRisk: pickBetterValue(gmgnData?.insiderRisk, birdeyeData?.insiderRisk, heuristicData?.insiderRisk),

      source: [
        gmgnData?.source,
        birdeyeData?.source,
        heuristicData?.source
      ].filter(Boolean).join(' -> ')
    };

    logHolderDebug('FINAL HOLDER INTELLIGENCE RETURN', {
      contractAddress,
      gmgnData,
      birdeyeData,
      heuristicData,
      finalResult
    });

    return finalResult;
  } catch (error) {
    console.error('[HolderIntelligenceProvider] Error:', error.message);
    logHolderDebug('Holder Intelligence Fatal Error', {
      contractAddress,
      error: error.message
    });
    return emptyHolderIntelligence('error');
  }
}

module.exports = { fetchHolderIntelligence };