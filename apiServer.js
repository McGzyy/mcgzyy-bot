'use strict';

const express = require('express');
const cors = require('cors');
const { loadReferrals } = require('./utils/referralService');

const PORT = 3001;

/**
 * @param {string} discordId
 * @returns {Promise<{ total: number, today: number, week: number, referrals: Array<{ userId: string, joinedAt: number }> }>}
 */
async function getReferralPayload(discordId) {
  const empty = { total: 0, today: 0, week: 0, referrals: [] };
  const uid = String(discordId || '').trim();
  if (!uid) return empty;

  const store = await loadReferrals();
  const rec = store.users.find(u => u.discordId === uid);
  if (!rec) return empty;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const sinceDay = now - dayMs;
  const sinceWeek = now - weekMs;
  let today = 0;
  let week = 0;

  for (const r of rec.referrals) {
    const t = Number(r.joinedAt) || 0;
    if (t >= sinceDay) today += 1;
    if (t >= sinceWeek) week += 1;
  }

  return {
    total: rec.referrals.length,
    today,
    week,
    referrals: rec.referrals
  };
}

function startReferralApiServer() {
  const app = express();

  app.use(cors());

  app.get('/referrals/:discordId', async (req, res) => {
    try {
      const discordId = req.params.discordId;
      const payload = await getReferralPayload(discordId);
      res.json(payload);
    } catch (e) {
      console.error('[API] GET /referrals/:discordId', e && e.message ? e.message : e);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`[API] Referral server listening on http://localhost:${PORT}`);
  });

  server.on('error', err => {
    console.error('[API] Referral server failed to start:', err.message || err);
  });

  return server;
}

module.exports = { startReferralApiServer };
