const { Connection, PublicKey } = require('@solana/web3.js');

function safeString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function getRpcUrl() {
  return (
    safeString(process.env.SOLANA_RPC_URL) ||
    'https://api.mainnet-beta.solana.com'
  );
}

/**
 * Fetch current SPL mint authorities (on-chain, not heuristics).
 * Note: this does NOT reliably identify the deployer/creator; it only exposes current authority keys.
 *
 * @param {string} mintAddress
 * @returns {Promise<{ ok: boolean, mintAuthority?: string|null, freezeAuthority?: string|null, rpc?: string, error?: string }>}
 */
async function fetchMintAuthorities(mintAddress) {
  try {
    const addr = safeString(mintAddress);
    if (!addr) return { ok: false, error: 'missing_mint' };

    const rpc = getRpcUrl();
    const connection = new Connection(rpc, {
      commitment: 'confirmed'
    });

    const pubkey = new PublicKey(addr);
    const res = await connection.getParsedAccountInfo(pubkey);
    const parsed = res?.value?.data?.parsed;
    if (!parsed || parsed?.type !== 'mint') {
      return { ok: false, rpc, error: 'not_mint_account' };
    }

    const info = parsed?.info || {};
    const mintAuthority = safeString(info?.mintAuthority) || null;
    const freezeAuthority = safeString(info?.freezeAuthority) || null;

    return {
      ok: true,
      rpc,
      mintAuthority,
      freezeAuthority
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  fetchMintAuthorities
};

