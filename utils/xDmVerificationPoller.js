const axios = require('axios');
const { buildOAuthHeader } = require('./xPoster');

function startXDmVerificationPoller() {
  console.log('[XVerify/DM] Poller started');

  const hasKeys = process.env.X_API_KEY && process.env.X_ACCESS_TOKEN;

  if (!hasKeys) {
    console.log('[XVerify/DM] Missing X API credentials');
  } else {
    console.log('[XVerify/DM] X credentials detected');
  }

  setInterval(async () => {
    try {
      const url = 'https://api.x.com/2/dm_events';

      const authHeader = buildOAuthHeader('GET', url);

      const response = await axios.get(url, {
        headers: {
          Authorization: authHeader
        }
      });

      console.log('[XVerify/DM] DM fetch success');
      console.log(JSON.stringify(response.data, null, 2));

    } catch (err) {
      console.log('[XVerify/DM] DM fetch error:', err.response?.status, err.response?.data || err.message);
    }
  }, 15000);
}

module.exports = { startXDmVerificationPoller };
