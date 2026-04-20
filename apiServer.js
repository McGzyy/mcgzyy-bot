'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const { PermissionFlagsBits } = require('discord.js');
const { readJson } = require('./utils/jsonStore');
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
const { applyDashboardCallDecision } = require('./utils/dashboardCallApproval');
const {
  isXOAuthConfigured,
  createXOAuthAuthorizeUrl,
  completeXOAuthCallback
} = require('./utils/xOAuthService');
const {
  completeXVerification,
  clearXAccountLink,
  upsertUserProfile,
  startXVerification,
  getUserProfileByDiscordId,
  normalizeXHandle,
  isLikelyXHandle,
  initUserProfilesStore
} = require('./utils/userProfileService');
const { generateXVerificationCode } = require('./utils/xVerificationCode');
const { getXBotUsernameForCopy } = require('./utils/xPoster');
const {
  computeApprovalAthX,
  getApprovalTriggerX,
  getHighestEligibleApprovalMilestone,
  getApprovalMilestoneLadder
} = require('./utils/approvalMilestoneService');
const {
  initScannerSettingsStore,
  loadScannerSettings,
  updateScannerSetting
} = require('./utils/scannerSettingsService');

const PORT = Number(process.env.REFERRAL_API_PORT || process.env.PORT || 3001);

/**
 * @param {string | null | undefined} guildId
 * @param {string | null | undefined} channelId
 * @param {string | null | undefined} messageId
 * @returns {string | null}
 */
function discordMessageJumpUrl(guildId, channelId, messageId) {
  const gid = guildId != null ? String(guildId).trim() : '';
  const cid = channelId != null ? String(channelId).trim() : '';
  const mid = messageId != null ? String(messageId).trim() : '';
  if (!gid || !cid || !mid) return null;
  return `https://discord.com/channels/${gid}/${cid}/${mid}`;
}

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
 * @param {{ getScannerEnabled?: () => boolean, applyScannerEnabled?: (enabled: boolean) => Promise<{ ok: boolean, error?: string, already?: boolean }> }} [opts]
 */
function startReferralApiServer(discordClient = null, opts = {}) {
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

  const getScannerEnabled = typeof opts.getScannerEnabled === 'function' ? opts.getScannerEnabled : null;
  const applyScannerEnabled =
    typeof opts.applyScannerEnabled === 'function' ? opts.applyScannerEnabled : null;

  function getBotCallsChannelFromGuild(guild) {
    if (!guild?.channels?.cache) return null;
    return (
      guild.channels.cache.find(
        ch =>
          ch &&
          ch.isTextBased &&
          typeof ch.isTextBased === 'function' &&
          ch.isTextBased() &&
          ch.name === 'bot-calls'
      ) || null
    );
  }

  function getPrimaryGuildForBotApi() {
    if (!discordClient?.guilds?.cache) return null;
    const envId = String(process.env.DISCORD_GUILD_ID || '').trim();
    if (envId) {
      const g = discordClient.guilds.cache.get(envId);
      if (g) return g;
    }
    const values = [...discordClient.guilds.cache.values()];
    if (values.length === 1) return values[0];
    const withBotCalls = values
      .filter(g => getBotCallsChannelFromGuild(g))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (withBotCalls.length) return withBotCalls[0];
    return values.sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
  }

  async function discordUserMayToggleScanner(userId) {
    const owner = String(process.env.BOT_OWNER_ID || '').trim();
    const uid = String(userId || '').trim();
    if (owner && uid === owner) return true;
    if (!discordClient?.isReady()) return false;
    const guild = getPrimaryGuildForBotApi();
    if (!guild) return false;
    const member = await guild.members.fetch(uid).catch(() => null);
    if (!member) return false;
    try {
      return member.permissions.has(PermissionFlagsBits.ManageGuild);
    } catch {
      return false;
    }
  }

  app.use(cors());
  app.use(express.json({ limit: '48kb' }));

  app.get('/health', async (req, res) => {
    const xOauth =
      !!String(process.env.X_OAUTH2_CLIENT_ID || '').trim() &&
      !!String(process.env.X_OAUTH2_CLIENT_SECRET || '').trim() &&
      !!String(process.env.X_OAUTH2_REDIRECT_URI || '').trim();

    let scannerEnabled = true;
    try {
      const botSettingsPath = path.join(__dirname, 'data', 'botSettings.json');
      const parsed = await readJson(botSettingsPath);
      scannerEnabled = parsed && /** @type {{ scannerEnabled?: boolean }} */ (parsed).scannerEnabled !== false;
    } catch (_) {
      scannerEnabled = true;
    }

    res.json({
      ok: true,
      scannerEnabled,
      discordReady: Boolean(discordClient && discordClient.isReady && discordClient.isReady()),
      processUptimeSec: Math.floor(process.uptime()),
      endpoints: {
        modQueueGet: true,
        scannerState: true,
        internalPost: ['call', 'watch', 'x-oauth/start', 'x-oauth/complete', 'x-oauth/unlink'],
        xOAuthConfigured: isXOAuthConfigured(),
        xOAuth2: xOauth
      },
      cwd: process.cwd(),
      loadedFrom: __filename
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
    const athRaw = computeApprovalAthX(call);
    const athMultipleX =
      Number.isFinite(athRaw) && athRaw > 0 ? Math.round(athRaw * 100) / 100 : null;
    const approvalTriggerX = getApprovalTriggerX();
    const eligibleTopMilestoneX = (() => {
      const m = getHighestEligibleApprovalMilestone(athRaw);
      return m > 0 ? m : null;
    })();
    const lastTrig = Number(call.lastApprovalTriggerX || 0);
    const gid = call.approvalGuildId != null ? call.approvalGuildId : null;
    const cid = call.approvalChannelId != null ? call.approvalChannelId : null;
    const mid = call.approvalMessageId != null ? call.approvalMessageId : null;

    return {
      contractAddress: call.contractAddress,
      tokenName: call.tokenName != null ? call.tokenName : null,
      ticker: call.ticker != null ? call.ticker : null,
      approvalRequestedAt: call.approvalRequestedAt != null ? call.approvalRequestedAt : null,
      approvalMessageId: mid,
      approvalGuildId: gid,
      approvalChannelId: cid,
      discordJumpUrl: discordMessageJumpUrl(gid, cid, mid),
      firstCallerUsername:
        call.firstCallerUsername != null ? call.firstCallerUsername : null,
      callSourceType: call.callSourceType != null ? call.callSourceType : null,
      chain: call.chain != null ? call.chain : null,
      athMultipleX,
      approvalTriggerX,
      eligibleTopMilestoneX,
      lastApprovalTriggerX: lastTrig > 0 ? lastTrig : null,
      approvalMilestonesTriggered: Array.isArray(call.approvalMilestonesTriggered)
        ? call.approvalMilestonesTriggered
        : []
    };
  }

  function serializeDevSubmissionRow(s) {
    const gid = s.approvalGuildId != null ? s.approvalGuildId : null;
    const cid = s.approvalChannelId != null ? s.approvalChannelId : null;
    const mid = s.approvalMessageId != null ? s.approvalMessageId : null;
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
      approvalMessageId: mid,
      approvalChannelId: cid,
      approvalGuildId: gid,
      discordJumpUrl: discordMessageJumpUrl(gid, cid, mid)
    };
  }

  const X_VERIFIED_ROLE_NAME = 'X Verified';

  async function assignXVerifiedRoleAcrossGuilds(discordUserId) {
    if (!discordClient || !discordClient.isReady()) return;
    const uid = String(discordUserId || '').trim();
    if (!uid) return;

    for (const guild of discordClient.guilds.cache.values()) {
      const role = guild.roles.cache.find(r => r.name === X_VERIFIED_ROLE_NAME);
      if (!role) continue;
      const member = await guild.members.fetch(uid).catch(() => null);
      if (!member || member.roles.cache.has(role.id)) continue;
      await member.roles.add(role).catch(() => {});
    }
  }

  app.post('/internal/x-oauth/start', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error:
            'CALL_INTERNAL_SECRET is not set on the bot host (required for dashboard X OAuth).'
        });
        return;
      }

      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const userId = String(
        body.userId || req.headers['x-discord-user-id'] || ''
      ).trim();
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'Missing userId (body.userId or X-Discord-User-Id header).'
        });
        return;
      }

      if (!isXOAuthConfigured()) {
        res.status(503).json({
          success: false,
          error:
            'X OAuth is not configured (set X_OAUTH2_CLIENT_ID, X_OAUTH2_CLIENT_SECRET, X_OAUTH2_REDIRECT_URI).'
        });
        return;
      }

      const { authUrl, state } = createXOAuthAuthorizeUrl(userId);
      res.json({ success: true, authUrl, state });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'x-oauth/start failed';
      console.error('[API] POST /internal/x-oauth/start', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.post('/internal/x-oauth/complete', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error:
            'CALL_INTERNAL_SECRET is not set on the bot host (required for dashboard X OAuth).'
        });
        return;
      }

      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const code = String(body.code || '').trim();
      const state = String(body.state || '').trim();
      if (!code || !state) {
        res.status(400).json({ success: false, error: 'Missing code or state' });
        return;
      }

      const { discordUserId, username } = await completeXOAuthCallback({ code, state });

      if (!getUserProfileByDiscordId(discordUserId)) {
        upsertUserProfile({
          discordUserId,
          username: '',
          displayName: ''
        });
      }

      completeXVerification(discordUserId, username);
      await assignXVerifiedRoleAcrossGuilds(discordUserId);

      res.json({ success: true, username, discordUserId });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'x-oauth/complete failed';
      console.error('[API] POST /internal/x-oauth/complete', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

  app.post('/internal/x-oauth/unlink', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error:
            'CALL_INTERNAL_SECRET is not set on the bot host (required for dashboard X OAuth).'
        });
        return;
      }

      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const userId = String(
        body.userId || req.headers['x-discord-user-id'] || ''
      ).trim();
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'Missing userId (body.userId or X-Discord-User-Id header).'
        });
        return;
      }

      let updated = clearXAccountLink(userId);
      if (!updated) {
        upsertUserProfile({
          discordUserId: userId,
          username: '',
          displayName: ''
        });
        updated = clearXAccountLink(userId);
      }

      res.json({ success: true, cleared: Boolean(updated) });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'x-oauth/unlink failed';
      console.error('[API] POST /internal/x-oauth/unlink', msg);
      res.status(400).json({ success: false, error: msg });
    }
  });

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
      const pendingAll = tracked.filter(pendingFilter);
      const pendingBot = pendingAll.filter(c => c.callSourceType === 'bot_call');
      const pendingUser = pendingAll.filter(c => c.callSourceType !== 'bot_call');

      const callApprovals = getPendingApprovals(limit, { callSourceType: 'bot_call' }).map(
        serializePendingCallApproval
      );
      const callApprovalsUser = getPendingApprovals(limit, {
        excludeCallSourceType: 'bot_call'
      }).map(serializePendingCallApproval);

      const devRows = await listDevSubmissionsPostedToModApprovals();
      const devSubmissions = devRows.map(serializeDevSubmissionRow);

      res.json({
        success: true,
        callApprovals,
        callApprovalsUser,
        devSubmissions,
        counts: {
          callApprovals: pendingBot.length,
          callApprovalsUser: pendingUser.length,
          devSubmissions: devSubmissions.length,
          total: pendingAll.length + devSubmissions.length
        }
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'mod-queue failed';
      console.error('[API] GET /internal/mod-queue', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  app.get('/internal/scanner-state', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error: 'CALL_INTERNAL_SECRET is not set on the bot host.'
        });
        return;
      }
      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = String(
        req.headers['x-discord-user-id'] || req.headers['X-Discord-User-Id'] || req.query.userId || ''
      ).trim();
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'Missing viewer id (X-Discord-User-Id header or userId query).'
        });
        return;
      }
      if (!getScannerEnabled) {
        res.status(503).json({
          success: false,
          error: 'Scanner runtime is not wired in this process (bot build too old or wrong entrypoint).'
        });
        return;
      }
      if (!(await discordUserMayToggleScanner(userId))) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }
      res.json({
        success: true,
        scannerEnabled: Boolean(getScannerEnabled()),
        discordReady: Boolean(discordClient && discordClient.isReady && discordClient.isReady())
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'scanner-state failed';
      console.error('[API] GET /internal/scanner-state', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  app.post('/internal/scanner-state', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error: 'CALL_INTERNAL_SECRET is not set on the bot host.'
        });
        return;
      }
      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = String(
        req.headers['x-discord-user-id'] || req.headers['X-Discord-User-Id'] || ''
      ).trim();
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'Missing X-Discord-User-Id header.'
        });
        return;
      }
      if (!getScannerEnabled || !applyScannerEnabled) {
        res.status(503).json({
          success: false,
          error: 'Scanner runtime is not wired in this process.'
        });
        return;
      }
      if (!(await discordUserMayToggleScanner(userId))) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (typeof body.enabled !== 'boolean') {
        res.status(400).json({
          success: false,
          error: 'JSON body must include boolean field "enabled".'
        });
        return;
      }
      const result = await applyScannerEnabled(Boolean(body.enabled));
      if (!result || !result.ok) {
        res.status(400).json({
          success: false,
          error: (result && result.error) || 'Failed to apply scanner state.'
        });
        return;
      }
      res.json({
        success: true,
        scannerEnabled: Boolean(getScannerEnabled()),
        already: result.already === true,
        discordReady: Boolean(discordClient && discordClient.isReady && discordClient.isReady())
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'scanner-state POST failed';
      console.error('[API] POST /internal/scanner-state', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  function isBotOwnerDiscordId(userId) {
    const owner = String(process.env.BOT_OWNER_ID || '').trim();
    return Boolean(owner && String(userId || '').trim() === owner);
  }

  app.get('/internal/scanner-settings', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CALL_INTERNAL_SECRET is not set on the bot host.' });
        return;
      }
      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = String(
        req.headers['x-discord-user-id'] || req.headers['X-Discord-User-Id'] || req.query.userId || ''
      ).trim();
      if (!userId) {
        res.status(400).json({ success: false, error: 'Missing viewer id (X-Discord-User-Id header or userId query).' });
        return;
      }
      if (!(await discordUserMayToggleScanner(userId))) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }
      await initScannerSettingsStore();
      const settings = loadScannerSettings();
      res.json({
        success: true,
        settings,
        approvalTriggerX: getApprovalTriggerX(),
        approvalMilestoneLadder: getApprovalMilestoneLadder()
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'scanner-settings GET failed';
      console.error('[API] GET /internal/scanner-settings', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  app.patch('/internal/scanner-settings', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CALL_INTERNAL_SECRET is not set on the bot host.' });
        return;
      }
      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const userId = String(req.headers['x-discord-user-id'] || req.headers['X-Discord-User-Id'] || '').trim();
      if (!userId) {
        res.status(400).json({ success: false, error: 'Missing X-Discord-User-Id header.' });
        return;
      }
      if (!isBotOwnerDiscordId(userId)) {
        res.status(403).json({
          success: false,
          error: 'Only the bot owner (BOT_OWNER_ID) may change scanner thresholds — same as Discord !setminmc / !setapprovalladder.'
        });
        return;
      }
      await initScannerSettingsStore();
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      if (!Object.keys(body).length) {
        res.status(400).json({ success: false, error: 'JSON body must include at least one field to update.' });
        return;
      }
      const numericKeys = new Set([
        'minMarketCap',
        'minLiquidity',
        'minVolume5m',
        'minVolume1h',
        'minTxns5m',
        'minTxns1h',
        'approvalTriggerX',
        'sanityMinMeaningfulMarketCap',
        'sanityMinMeaningfulLiquidity',
        'sanityMinLiquidityToMarketCapRatio',
        'sanityMaxLiquidityToMarketCapRatio',
        'sanityMaxBuySellRatio5m',
        'sanityMaxBuySellRatio1h'
      ]);
      const errors = [];
      const updatedKeys = [];
      const keys = Object.keys(body).sort((a, b) => {
        if (a === 'approvalMilestoneLadder') return -1;
        if (b === 'approvalMilestoneLadder') return 1;
        return a.localeCompare(b);
      });

      for (const key of keys) {
        if (key === 'approvalMilestoneLadder') {
          const raw = body[key];
          let arr = [];
          if (Array.isArray(raw)) {
            arr = raw;
          } else if (typeof raw === 'string') {
            arr = raw.split(',').map(s => Number(String(s).trim()));
          } else {
            errors.push('approvalMilestoneLadder must be a number[] or comma-separated string');
            continue;
          }
          const ladder = arr.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1);
          const uniqueSorted = [...new Set(ladder)].sort((a, b) => a - b);
          if (!uniqueSorted.length) {
            errors.push('approvalMilestoneLadder has no valid values (>= 1)');
            continue;
          }
          if (!updateScannerSetting('approvalMilestoneLadder', uniqueSorted)) {
            errors.push('Failed to save approvalMilestoneLadder');
            continue;
          }
          if (!updateScannerSetting('approvalTriggerX', uniqueSorted[0])) {
            errors.push('Failed to sync approvalTriggerX to ladder minimum');
            continue;
          }
          updatedKeys.push('approvalMilestoneLadder', 'approvalTriggerX');
          continue;
        }
        if (!numericKeys.has(key)) {
          errors.push(`Unknown or read-only field: ${key}`);
          continue;
        }
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 0) {
          errors.push(`${key} must be a finite number >= 0`);
          continue;
        }
        if (key === 'approvalTriggerX' && n < 1) {
          errors.push('approvalTriggerX must be >= 1');
          continue;
        }
        if (!updateScannerSetting(key, n)) {
          errors.push(`Failed to update ${key}`);
          continue;
        }
        updatedKeys.push(key);
        if (key === 'approvalTriggerX') {
          updateScannerSetting('approvalMilestoneLadder', []);
        }
      }

      if (errors.length) {
        res.status(400).json({
          success: false,
          error: errors.join('; '),
          errors,
          settings: loadScannerSettings(),
          approvalTriggerX: getApprovalTriggerX(),
          approvalMilestoneLadder: getApprovalMilestoneLadder()
        });
        return;
      }

      res.json({
        success: true,
        updatedKeys,
        settings: loadScannerSettings(),
        approvalTriggerX: getApprovalTriggerX(),
        approvalMilestoneLadder: getApprovalMilestoneLadder()
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'scanner-settings PATCH failed';
      console.error('[API] PATCH /internal/scanner-settings', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  app.post('/internal/x-verify/start', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error: 'CALL_INTERNAL_SECRET is not set on the bot host.'
        });
        return;
      }

      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const discordUserId = String(
        req.headers['x-discord-user-id'] || req.headers['X-Discord-User-Id'] || ''
      ).trim();
      if (!discordUserId) {
        res.status(400).json({
          success: false,
          error: 'Missing X-Discord-User-Id header.'
        });
        return;
      }

      await initUserProfilesStore();

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const rawHandle = String(body.handle || body.xHandle || '').trim();
      const handle = normalizeXHandle(rawHandle);

      if (!isLikelyXHandle(handle)) {
        res.status(400).json({
          success: false,
          error: 'Enter a valid X handle (letters, numbers, underscore; max 15).'
        });
        return;
      }

      const existing = getUserProfileByDiscordId(discordUserId);
      if (!existing) {
        const username = String(body.discordUsername || '').trim().slice(0, 80);
        const displayName = String(body.displayName || '').trim().slice(0, 100);
        upsertUserProfile({
          discordUserId,
          username: username || 'member',
          displayName: displayName || username || 'member'
        });
      }

      const code = generateXVerificationCode(discordUserId, handle);
      startXVerification(discordUserId, handle, code);

      res.json({
        success: true,
        handle,
        code,
        xBotUsername: getXBotUsernameForCopy()
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'x-verify start failed';
      console.error('[API] POST /internal/x-verify/start', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  app.get('/internal/x-verify/status', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error: 'CALL_INTERNAL_SECRET is not set on the bot host.'
        });
        return;
      }

      const auth = String(req.headers.authorization || '').trim();
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const discordUserId = String(
        req.headers['x-discord-user-id'] || req.headers['X-Discord-User-Id'] || ''
      ).trim();
      if (!discordUserId) {
        res.status(400).json({
          success: false,
          error: 'Missing X-Discord-User-Id header.'
        });
        return;
      }

      await initUserProfilesStore();

      const profile = getUserProfileByDiscordId(discordUserId);
      if (!profile) {
        res.json({
          success: true,
          isXVerified: false,
          xVerificationStatus: 'none',
          requestedHandle: '',
          verifiedXHandle: ''
        });
        return;
      }

      const st = String(profile.xVerification?.status || 'none').toLowerCase();

      res.json({
        success: true,
        isXVerified: !!profile.isXVerified,
        xVerificationStatus: st,
        requestedHandle: normalizeXHandle(profile.xVerification?.requestedHandle || ''),
        verifiedXHandle: normalizeXHandle(profile.verifiedXHandle || '')
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'x-verify status failed';
      console.error('[API] GET /internal/x-verify/status', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  app.post('/internal/mod/call-decision', async (req, res) => {
    try {
      const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
      if (!secret) {
        res.status(503).json({
          success: false,
          error:
            'CALL_INTERNAL_SECRET is not set on the bot host (required for dashboard mod actions).'
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
      const contractAddress = String(body.contractAddress || '').trim();
      const decision = String(body.decision || '')
        .toLowerCase()
        .trim();

      if (!userId || !contractAddress || !decision) {
        res.status(400).json({
          success: false,
          error: 'Missing userId, contractAddress, or decision'
        });
        return;
      }

      if (!isModOrAdminDiscordUserId(userId)) {
        res.status(403).json({ success: false, error: 'Forbidden' });
        return;
      }

      let moderatorUsername = 'moderator';
      try {
        const u = await discordClient.users.fetch(userId);
        if (u && u.username) moderatorUsername = u.username;
      } catch (_) {
        /* non-fatal */
      }

      const result = await applyDashboardCallDecision(discordClient, {
        contractAddress,
        decision,
        moderatorId: userId,
        moderatorUsername
      });

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error || 'Action failed'
        });
        return;
      }

      res.json({
        success: true,
        discordMessageSkipped: result.discordMessageSkipped === true,
        warning: result.warning || null,
        xPublish: result.xPublish != null ? result.xPublish : null
      });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'call-decision failed';
      console.error('[API] POST /internal/mod/call-decision', msg);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server listening on http://0.0.0.0:${PORT}`);
    console.log(`[API] Loaded apiServer from: ${__filename}`);
    console.log(`[API] process.cwd(): ${process.cwd()}`);
    console.log(
      `[API] Health check: http://127.0.0.1:${PORT}/health (expect ok + endpoints.modQueueGet)`
    );
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
