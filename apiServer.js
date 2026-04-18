'use strict';

const express = require('express');
const cors = require('cors');
const { loadReferrals } = require('./utils/referralService');
const { handleCallFromDashboard } = require('./commands/basicCommands');

const PORT = Number(process.env.REFERRAL_API_PORT || process.env.PORT || 3001);

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

/**
 * @param {import('discord.js').Client | null} [discordClient]
 */
function startReferralApiServer(discordClient = null) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '48kb' }));

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/ping', (req, res) => {
    res.send('pong');
  });

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

  app.post('/internal/call', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error:
            'CALL_INTERNAL_SECRET is not set on the bot host (required for dashboard submit call).'
        });
        return;
      }

      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      if (!discordClient || !discordClient.isReady()) {
        res.status(503).json({
          success: false,
          error: 'Discord client is not ready yet; retry in a few seconds.'
        });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const userId = String(body.userId || '').trim();
      const ca = String(body.ca || '').trim();

      if (!userId || !ca) {
        res.status(400).json({ success: false, error: 'Missing userId or ca' });
        return;
      }

      const webhookUrl = String(
        process.env.DISCORD_USER_CALLS_WEBHOOK_URL || ''
      ).trim();

      await handleCallFromDashboard(discordClient, {
        userId,
        contractAddress: ca,
        webhookUrl: webhookUrl || null
      });

      res.json({ success: true });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'Call failed';
      console.error('[API] POST /internal/call', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[API] Health check: http://127.0.0.1:${PORT}/health (expect {"ok":true})`);
  });

  server.on('error', err => {
    console.error('[API] Referral server failed to start:', err.message || err);
  });

  return server;
}

module.exports = { startReferralApiServer };
