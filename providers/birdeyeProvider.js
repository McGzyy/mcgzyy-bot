const axios = require('axios');

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function safeString(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function buildBuySellRatio(buys, sells) {
  const buyNum = safeNumber(buys);
  const sellNum = safeNumber(sells);

  if (buyNum === null || sellNum === null) return null;
  if (sellNum === 0 && buyNum > 0) return buyNum;
  if (sellNum === 0) return null;

  return Number((buyNum / sellNum).toFixed(2));
}

function firstValidNumber(...values) {
  for (const value of values) {
    const num = safeNumber(value);
    if (num !== null) return num;
  }
  return null;
}

async function fetchBirdeyeData(contractAddress, pairAddress = null) {
  const apiKey = process.env.BIRDEYE_API_KEY;

  if (!apiKey || !contractAddress) {
    return {
      market: null,
      metadata: null,
      trade: null,
      pair: null,
      source: 'birdeye-missing-config'
    };
  }

  const headers = {
    'X-API-KEY': apiKey,
    'x-chain': 'solana'
  };

  try {
    const requests = [
      axios.get(
        `https://public-api.birdeye.so/defi/v3/token/market-data?address=${contractAddress}`,
        { headers }
      ),
      axios.get(
        `https://public-api.birdeye.so/defi/v3/token/meta-data?address=${contractAddress}`,
        { headers }
      ),
      axios.get(
        `https://public-api.birdeye.so/defi/v3/token/trade-data?address=${contractAddress}&frames=1m,5m,15m,30m,1h,2h,4h,8h,12h,24h`,
        { headers }
      )
    ];

    if (pairAddress) {
      requests.push(
        axios.get(
          `https://public-api.birdeye.so/defi/v3/pair/overview/single?address=${pairAddress}`,
          { headers }
        )
      );
    }

    const results = await Promise.allSettled(requests);

    const marketRaw =
      results[0]?.status === 'fulfilled'
        ? results[0].value?.data?.data || null
        : null;

    const metadataRaw =
      results[1]?.status === 'fulfilled'
        ? results[1].value?.data?.data || null
        : null;

    const tradeRaw =
      results[2]?.status === 'fulfilled'
        ? results[2].value?.data?.data || null
        : null;

    const pairRaw =
      pairAddress && results[3]?.status === 'fulfilled'
        ? results[3].value?.data?.data || null
        : null;

    // --------------------------------
    // DEBUG LOGS (TEMPORARY)
    // --------------------------------
    console.log('\n================ BIRDEYE DEBUG ================');
    console.log('[BIRDEYE DEBUG] Contract:', contractAddress);
    console.log('[BIRDEYE DEBUG] Pair:', pairAddress || 'none');

    console.log('\n[BIRDEYE DEBUG] tradeRaw keys:');
    console.log(tradeRaw ? Object.keys(tradeRaw) : 'NO TRADE RAW');

    console.log('\n[BIRDEYE DEBUG] pairRaw keys:');
    console.log(pairRaw ? Object.keys(pairRaw) : 'NO PAIR RAW');

    console.log('\n[BIRDEYE DEBUG] tradeRaw important values:');
    console.log({
      volume_1m: tradeRaw?.volume_1m,
      volume_5m: tradeRaw?.volume_5m,
      volume_15m: tradeRaw?.volume_15m,
      volume_30m: tradeRaw?.volume_30m,
      volume_1h: tradeRaw?.volume_1h,
      buy_5m: tradeRaw?.buy_5m,
      sell_5m: tradeRaw?.sell_5m,
      buy_15m: tradeRaw?.buy_15m,
      sell_15m: tradeRaw?.sell_15m,
      buy_1h: tradeRaw?.buy_1h,
      sell_1h: tradeRaw?.sell_1h,
      unique_wallet_1m: tradeRaw?.unique_wallet_1m,
      unique_wallet_5m: tradeRaw?.unique_wallet_5m,
      unique_wallet_15m: tradeRaw?.unique_wallet_15m,
      unique_wallet_30m: tradeRaw?.unique_wallet_30m,
      unique_wallet_1h: tradeRaw?.unique_wallet_1h,
      unique_wallet_24h: tradeRaw?.unique_wallet_24h,
      unique_wallet_history_1m: tradeRaw?.unique_wallet_history_1m,
      unique_wallet_history_5m: tradeRaw?.unique_wallet_history_5m,
      unique_wallet_history_15m: tradeRaw?.unique_wallet_history_15m,
      unique_wallet_history_30m: tradeRaw?.unique_wallet_history_30m,
      unique_wallet_history_1h: tradeRaw?.unique_wallet_history_1h,
      unique_wallet_history_24h: tradeRaw?.unique_wallet_history_24h
    });

    console.log('\n[BIRDEYE DEBUG] pairRaw important values:');
    console.log({
      volume_30m: pairRaw?.volume_30m,
      volume_30m_quote: pairRaw?.volume_30m_quote,
      volume_1h: pairRaw?.volume_1h,
      volume_1h_quote: pairRaw?.volume_1h_quote,
      volume_24h: pairRaw?.volume_24h,
      volume_24h_quote: pairRaw?.volume_24h_quote,
      trade_30m: pairRaw?.trade_30m,
      trade_history_30m: pairRaw?.trade_history_30m,
      trade_1h: pairRaw?.trade_1h,
      trade_history_1h: pairRaw?.trade_history_1h,
      trade_24h: pairRaw?.trade_24h,
      trade_history_24h: pairRaw?.trade_history_24h,
      unique_wallet_30m: pairRaw?.unique_wallet_30m,
      unique_wallet_1h: pairRaw?.unique_wallet_1h,
      unique_wallet_24h: pairRaw?.unique_wallet_24h
    });

    console.log('================ END BIRDEYE DEBUG ================\n');

    const market = marketRaw
      ? {
          price: safeNumber(marketRaw.price),
          marketCap: safeNumber(marketRaw.market_cap),
          liquidity: safeNumber(marketRaw.liquidity),
          fdv: safeNumber(marketRaw.fdv),
          circulatingSupply: safeNumber(marketRaw.circulating_supply),
          totalSupply: safeNumber(marketRaw.total_supply),
          holders: safeNumber(marketRaw.holder),

          priceChange5m: safeNumber(marketRaw.price_change_5m_percent),
          priceChange15m: safeNumber(marketRaw.price_change_15m_percent),
          priceChange30m: safeNumber(marketRaw.price_change_30m_percent),
          priceChange1h: safeNumber(marketRaw.price_change_1h_percent),
          priceChange2h: safeNumber(marketRaw.price_change_2h_percent),
          priceChange4h: safeNumber(marketRaw.price_change_4h_percent),
          priceChange8h: safeNumber(marketRaw.price_change_8h_percent),
          priceChange12h: safeNumber(marketRaw.price_change_12h_percent),
          priceChange24h: safeNumber(marketRaw.price_change_24h_percent),

          volume5m: safeNumber(marketRaw.volume_5m_usd),
          volume15m: safeNumber(marketRaw.volume_15m_usd),
          volume30m: safeNumber(marketRaw.volume_30m_usd),
          volume1h: safeNumber(marketRaw.volume_1h_usd),
          volume2h: safeNumber(marketRaw.volume_2h_usd),
          volume4h: safeNumber(marketRaw.volume_4h_usd),
          volume8h: safeNumber(marketRaw.volume_8h_usd),
          volume12h: safeNumber(marketRaw.volume_12h_usd),
          volume24h: safeNumber(marketRaw.volume_24h_usd),

          trades5m: safeNumber(marketRaw.trade_5m),
          trades15m: safeNumber(marketRaw.trade_15m),
          trades30m: safeNumber(marketRaw.trade_30m),
          trades1h: safeNumber(marketRaw.trade_1h),
          trades2h: safeNumber(marketRaw.trade_2h),
          trades4h: safeNumber(marketRaw.trade_4h),
          trades8h: safeNumber(marketRaw.trade_8h),
          trades12h: safeNumber(marketRaw.trade_12h),
          trades24h: safeNumber(marketRaw.trade_24h),

          buyVolume5m: safeNumber(marketRaw.buy_volume_5m_usd),
          buyVolume15m: safeNumber(marketRaw.buy_volume_15m_usd),
          buyVolume30m: safeNumber(marketRaw.buy_volume_30m_usd),
          buyVolume1h: safeNumber(marketRaw.buy_volume_1h_usd),
          buyVolume2h: safeNumber(marketRaw.buy_volume_2h_usd),
          buyVolume4h: safeNumber(marketRaw.buy_volume_4h_usd),
          buyVolume8h: safeNumber(marketRaw.buy_volume_8h_usd),
          buyVolume12h: safeNumber(marketRaw.buy_volume_12h_usd),
          buyVolume24h: safeNumber(marketRaw.buy_volume_24h_usd),

          sellVolume5m: safeNumber(marketRaw.sell_volume_5m_usd),
          sellVolume15m: safeNumber(marketRaw.sell_volume_15m_usd),
          sellVolume30m: safeNumber(marketRaw.sell_volume_30m_usd),
          sellVolume1h: safeNumber(marketRaw.sell_volume_1h_usd),
          sellVolume2h: safeNumber(marketRaw.sell_volume_2h_usd),
          sellVolume4h: safeNumber(marketRaw.sell_volume_4h_usd),
          sellVolume8h: safeNumber(marketRaw.sell_volume_8h_usd),
          sellVolume12h: safeNumber(marketRaw.sell_volume_12h_usd),
          sellVolume24h: safeNumber(marketRaw.sell_volume_24h_usd)
        }
      : null;

    const metadata = metadataRaw
      ? {
          name: safeString(metadataRaw.name),
          symbol: safeString(metadataRaw.symbol),
          description: safeString(metadataRaw.description),
          logoURI: safeString(metadataRaw.logo_uri),
          website: safeString(metadataRaw.website),
          twitter: safeString(metadataRaw.twitter),
          telegram: safeString(metadataRaw.telegram),
          discord: safeString(metadataRaw.discord),

          extensions: metadataRaw.extensions || null,
          tags: Array.isArray(metadataRaw.tags) ? metadataRaw.tags : [],
          coingeckoId: safeString(metadataRaw.cg_id)
        }
      : null;

    const trade = tradeRaw
      ? {
          volume24h: firstValidNumber(tradeRaw.volume_24h),
          volume12h: firstValidNumber(tradeRaw.volume_12h),
          volume8h: firstValidNumber(tradeRaw.volume_8h),
          volume4h: firstValidNumber(tradeRaw.volume_4h),
          volume2h: firstValidNumber(tradeRaw.volume_2h),
          volume1h: firstValidNumber(tradeRaw.volume_1h),
          volume30m: firstValidNumber(tradeRaw.volume_30m),
          volume15m: firstValidNumber(tradeRaw.volume_15m),
          volume5m: firstValidNumber(tradeRaw.volume_5m),
          volume1m: firstValidNumber(tradeRaw.volume_1m),

          buys24h: firstValidNumber(tradeRaw.buy_24h),
          sells24h: firstValidNumber(tradeRaw.sell_24h),
          buys12h: firstValidNumber(tradeRaw.buy_12h),
          sells12h: firstValidNumber(tradeRaw.sell_12h),
          buys8h: firstValidNumber(tradeRaw.buy_8h),
          sells8h: firstValidNumber(tradeRaw.sell_8h),
          buys4h: firstValidNumber(tradeRaw.buy_4h),
          sells4h: firstValidNumber(tradeRaw.sell_4h),
          buys2h: firstValidNumber(tradeRaw.buy_2h),
          sells2h: firstValidNumber(tradeRaw.sell_2h),
          buys1h: firstValidNumber(tradeRaw.buy_1h),
          sells1h: firstValidNumber(tradeRaw.sell_1h),
          buys30m: firstValidNumber(tradeRaw.buy_30m),
          sells30m: firstValidNumber(tradeRaw.sell_30m),
          buys15m: firstValidNumber(tradeRaw.buy_15m),
          sells15m: firstValidNumber(tradeRaw.sell_15m),
          buys5m: firstValidNumber(tradeRaw.buy_5m),
          sells5m: firstValidNumber(tradeRaw.sell_5m),
          buys1m: firstValidNumber(tradeRaw.buy_1m),
          sells1m: firstValidNumber(tradeRaw.sell_1m),

          uniqueWallets24h: firstValidNumber(
            tradeRaw.unique_wallet_24h,
            tradeRaw.unique_wallet_history_24h
          ),
          uniqueWallets12h: firstValidNumber(
            tradeRaw.unique_wallet_12h,
            tradeRaw.unique_wallet_history_12h
          ),
          uniqueWallets8h: firstValidNumber(
            tradeRaw.unique_wallet_8h,
            tradeRaw.unique_wallet_history_8h
          ),
          uniqueWallets4h: firstValidNumber(
            tradeRaw.unique_wallet_4h,
            tradeRaw.unique_wallet_history_4h
          ),
          uniqueWallets2h: firstValidNumber(
            tradeRaw.unique_wallet_2h,
            tradeRaw.unique_wallet_history_2h
          ),
          uniqueWallets1h: firstValidNumber(
            tradeRaw.unique_wallet_1h,
            tradeRaw.unique_wallet_history_1h
          ),
          uniqueWallets30m: firstValidNumber(
            tradeRaw.unique_wallet_30m,
            tradeRaw.unique_wallet_history_30m
          ),
          uniqueWallets15m: firstValidNumber(
            tradeRaw.unique_wallet_15m,
            tradeRaw.unique_wallet_history_15m
          ),
          uniqueWallets5m: firstValidNumber(
            tradeRaw.unique_wallet_5m,
            tradeRaw.unique_wallet_history_5m
          ),
          uniqueWallets1m: firstValidNumber(
            tradeRaw.unique_wallet_1m,
            tradeRaw.unique_wallet_history_1m
          ),

          buySellRatio24h: buildBuySellRatio(tradeRaw.buy_24h, tradeRaw.sell_24h),
          buySellRatio12h: buildBuySellRatio(tradeRaw.buy_12h, tradeRaw.sell_12h),
          buySellRatio8h: buildBuySellRatio(tradeRaw.buy_8h, tradeRaw.sell_8h),
          buySellRatio4h: buildBuySellRatio(tradeRaw.buy_4h, tradeRaw.sell_4h),
          buySellRatio2h: buildBuySellRatio(tradeRaw.buy_2h, tradeRaw.sell_2h),
          buySellRatio1h: buildBuySellRatio(tradeRaw.buy_1h, tradeRaw.sell_1h),
          buySellRatio30m: buildBuySellRatio(tradeRaw.buy_30m, tradeRaw.sell_30m),
          buySellRatio15m: buildBuySellRatio(tradeRaw.buy_15m, tradeRaw.sell_15m),
          buySellRatio5m: buildBuySellRatio(tradeRaw.buy_5m, tradeRaw.sell_5m),
          buySellRatio1m: buildBuySellRatio(tradeRaw.buy_1m, tradeRaw.sell_1m)
        }
      : null;

    const pair = pairRaw
      ? {
          pairAddress: safeString(pairRaw.address),
          liquidity: safeNumber(pairRaw.liquidity),
          price: safeNumber(pairRaw.price),

          volume30m: firstValidNumber(pairRaw.volume_30m, pairRaw.volume_30m_quote),
          volume1h: firstValidNumber(pairRaw.volume_1h, pairRaw.volume_1h_quote),
          volume2h: firstValidNumber(pairRaw.volume_2h, pairRaw.volume_2h_quote),
          volume4h: firstValidNumber(pairRaw.volume_4h, pairRaw.volume_4h_quote),
          volume8h: firstValidNumber(pairRaw.volume_8h, pairRaw.volume_8h_quote),
          volume12h: firstValidNumber(pairRaw.volume_12h, pairRaw.volume_12h_quote),
          volume24h: firstValidNumber(pairRaw.volume_24h, pairRaw.volume_24h_quote),

          trade30m: firstValidNumber(pairRaw.trade_30m, pairRaw.trade_history_30m),
          trade1h: firstValidNumber(pairRaw.trade_1h, pairRaw.trade_history_1h),
          trade2h: firstValidNumber(pairRaw.trade_2h, pairRaw.trade_history_2h),
          trade4h: firstValidNumber(pairRaw.trade_4h, pairRaw.trade_history_4h),
          trade8h: firstValidNumber(pairRaw.trade_8h, pairRaw.trade_history_8h),
          trade12h: firstValidNumber(pairRaw.trade_12h, pairRaw.trade_history_12h),
          trade24h: firstValidNumber(pairRaw.trade_24h, pairRaw.trade_history_24h),

          uniqueWallet24h: firstValidNumber(pairRaw.unique_wallet_24h),
          uniqueWallet12h: firstValidNumber(pairRaw.unique_wallet_12h),
          uniqueWallet8h: firstValidNumber(pairRaw.unique_wallet_8h),
          uniqueWallet4h: firstValidNumber(pairRaw.unique_wallet_4h),
          uniqueWallet2h: firstValidNumber(pairRaw.unique_wallet_2h),
          uniqueWallet1h: firstValidNumber(pairRaw.unique_wallet_1h),
          uniqueWallet30m: firstValidNumber(pairRaw.unique_wallet_30m),

          priceChange24h: safeNumber(pairRaw.price_change_24h_percent),
          tradeChange24h: safeNumber(pairRaw.trade_24h_change_percent),
          uniqueWalletChange24h: safeNumber(pairRaw.unique_wallet_24h_change_percent),

          sourceDex: safeString(pairRaw.source),
          pairName: safeString(pairRaw.name)
        }
      : null;

    return {
      market,
      metadata,
      trade,
      pair,
      source: 'birdeye'
    };
  } catch (error) {
    console.error('[BirdeyeProvider] Error:', error.message);

    return {
      market: null,
      metadata: null,
      trade: null,
      pair: null,
      source: 'birdeye-error'
    };
  }
}

module.exports = {
  fetchBirdeyeData
};