'use strict';

const express = require('express');
const cors = require('cors');
const { loadReferrals } = require('./utils/referralService');
const {
  handleCallFromDashboard,
  handleWatchFromDashboard
} = require('./commands/basicCommands');
const {
  initTrackedCallsStore,
  getAllTrackedCalls,
  getPendingApprovals
} = require('./utils/trackedCallsService');
const { listDevSubmissionsPostedToModApprovals } = require('./utils/devSubmissionService');
const { isModOrAdminDiscordUserId } = require('./utils/modStaffGate');

const PORT = Number(process.env.REFERRAL_API_PORT || process.env.PORT || 3001);

/** @type {import('http').Server | null} */
let referralHttpServerBinding = null;

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
  if (referralHttpServerBinding) {
    if (referralHttpServerBinding.listening) {
      console.warn(
        '[API] startReferralApiServer called again while already listening; ignoring duplicate (fixes EADDRINUSE from double bind in one process).'
      );
      return referralHttpServerBinding;
    }
    console.warn(
      '[API] startReferralApiServer called again while bind is in flight; returning existing server handle.'
    );
    return referralHttpServerBinding;
  }

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '48kb' }));

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      /** Present on builds that register GET /internal/mod-queue (dashboard mod approvals). */
      endpoints: {
        modQueueGet: true,
        internalPost: ['call', 'watch']
      }
    });
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

  app.post('/internal/watch', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error:
            'CALL_INTERNAL_SECRET is not set on the bot host (required for dashboard submit watch).'
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

      await handleWatchFromDashboard(discordClient, {
        userId,
        contractAddress: ca,
        webhookUrl: webhookUrl || null
      });

      res.json({ success: true });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'Watch failed';
      console.error('[API] POST /internal/watch', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  function serializePendingCallApproval(call) {
    return {
      contractAddress: call.contractAddress,
      tokenName: call.tokenName != null ? call.tokenName : null,
      ticker: call.ticker != null ? call.ticker : null,
      approvalRequestedAt: call.approvalRequestedAt != null ? call.approvalRequestedAt : null,
      approvalMessageId: call.approvalMessageId != null ? call.approvalMessageId : null,
      firstCallerUsername:
        call.firstCallerUsername != null ? call.firstCallerUsername : null,
      callSourceType: call.callSourceType != null ? call.callSourceType : null,
      chain: call.chain != null ? call.chain : null
    };
  }

  function serializeDevSubmissionRow(s) {
    return {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt != null ? s.updatedAt : null,
      submitterId: s.submitterId != null ? s.submitterId : null,
      submitterUsername: s.submitterUsername != null ? s.submitterUsername : null,
      nickname: s.nickname != null ? s.nickname : null,
      walletAddresses: s.walletAddresses != null ? s.walletAddresses : null,
      coinAddresses: s.coinAddresses != null ? s.coinAddresses : null,
      tags: s.tags != null ? s.tags : null,
      notes: s.notes != null ? s.notes : null,
      approvalMessageId: s.approvalMessageId != null ? s.approvalMessageId : null,
      approvalChannelId: s.approvalChannelId != null ? s.approvalChannelId : null
    };
  }

  app.get('/internal/mod-queue', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error:
            'CALL_INTERNAL_SECRET is not set on the bot host (required for dashboard mod queue).'
        });
        return;
      }

      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const userId = String(
        req.headers['x-discord-user-id'] || req.query.userId || ''
      ).trim();
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'Missing viewer id (X-Discord-User-Id header or userId query).'
        });
        return;
      }

      if (!isModOrAdminDiscordUserId(userId)) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }

      await initTrackedCallsStore();

      const limitRaw = Number(req.query.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500
          ? Math.floor(limitRaw)
          : 100;

      const tracked = getAllTrackedCalls();
      const pendingFilter = call =>
        String(call.approvalStatus || '').toLowerCase() === 'pending' &&
        !!call.approvalRequestedAt &&
        !!call.approvalMessageId;
      const callApprovalCount = tracked.filter(pendingFilter).length;

      const callApprovals = getPendingApprovals(limit).map(serializePendingCallApproval);

      const devRows = await listDevSubmissionsPostedToModApprovals();
      const devSubmissions = devRows.map(serializeDevSubmissionRow);

      res.json({
        success: true,
        callApprovals,
        devSubmissions,
        counts: {
          callApprovals: callApprovalCount,
          devSubmissions: devSubmissions.length,
          total: callApprovalCount + devSubmissions.length
        }
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'mod-queue failed';
      console.error('[API] GET /internal/mod-queue', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[API] Health check: http://127.0.0.1:${PORT}/health (expect {"ok":true})`);
  });

  referralHttpServerBinding = server;

  server.on('error', err => {
    console.error('[API] Referral server failed to start:', err.message || err);
    if (String(err && err.code) === 'EADDRINUSE') {
      console.error(
        `[API] Port ${PORT} is already in use. Stop the other process (second terminal, old pm2 instance, or another app), or set REFERRAL_API_PORT to a free port and update BOT_API_URL.`
      );
    }
    if (referralHttpServerBinding === server) {
      referralHttpServerBinding = null;
    }
  });

  return server;
}

module.exports = { startReferralApiServer };
