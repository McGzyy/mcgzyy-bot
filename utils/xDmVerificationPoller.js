'use strict';

const {
  listDmMessageCreates,
  lookupXUsernamesByIds,
  fetchXAuthenticatedUser
} = require('./xPoster');
const {
  getPendingXVerifications,
  getUserProfileByDiscordId,
  normalizeXHandle,
  completeXVerification
} = require('./userProfileService');

let warnedDmPermission403 = false;
let cachedBotXUserId = null;

function hasXOAuthCredentials() {
  return !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
}

function normalizeHandleCompare(value) {
  return String(normalizeXHandle(value) || '').toLowerCase();
}

function dmTextContainsCode(text, code) {
  if (!code || !text) {
    return false;
  }

  const compact = String(text).replace(/\s+/g, '');
  const needle = String(code).replace(/\s+/g, '');

  if (compact.includes(needle)) {
    return true;
  }

  return String(text).toUpperCase().includes(String(code).toUpperCase());
}

/**
 * Match pending profile verifications against recent inbound X DMs.
 * @param {import('discord.js').Client} client
 * @param {{ onVerified?: (args: { discordUserId: string, handle: string, dmEventId: string }) => Promise<void> | void }} [hooks]
 */
async function runXDmVerificationPass(client, hooks = {}) {
  if (!hasXOAuthCredentials()) {
    return;
  }

  if (!cachedBotXUserId) {
    const me = await fetchXAuthenticatedUser();
    if (me?.id) {
      cachedBotXUserId = me.id;
    }
  }

  const dmResult = await listDmMessageCreates({ maxResults: 100 });

  if (!dmResult.ok) {
    const st = dmResult.httpStatus;
    if (st === 403 && !warnedDmPermission403) {
      warnedDmPermission403 = true;
      console.warn(
        '[XVerify/DM] Cannot read DMs (403). In the X developer portal, enable Direct Message access for the app and regenerate the user access token.'
      );
    } else if (st && st !== 403) {
      console.error('[XVerify/DM] listDmMessageCreates failed:', st, dmResult.error);
    }
    return;
  }

  const pending = getPendingXVerifications(500);
  if (!pending.length) {
    return;
  }

  console.log('[XVerify/DM] Polling…', { pendingProfiles: pending.length, dmEvents: dmResult.events.length });

  const senderIdsNeedingLookup = new Set();

  for (const ev of dmResult.events) {
    if (cachedBotXUserId && ev.senderId === cachedBotXUserId) {
      continue;
    }

    if (!dmResult.usersById.has(ev.senderId)) {
      senderIdsNeedingLookup.add(ev.senderId);
    }
  }

  const extraUsernames = await lookupXUsernamesByIds([...senderIdsNeedingLookup]);

  for (const ev of dmResult.events) {
    if (cachedBotXUserId && ev.senderId === cachedBotXUserId) {
      continue;
    }

    const fromMap = dmResult.usersById.get(ev.senderId);
    let senderUsername =
      (fromMap && fromMap.username) || extraUsernames.get(ev.senderId) || '';

    senderUsername = normalizeHandleCompare(senderUsername);
    if (!senderUsername) {
      continue;
    }

    for (const profile of pending) {
      const discordUserId = profile?.discordUserId;
      if (!discordUserId) {
        continue;
      }

      const fresh = getUserProfileByDiscordId(discordUserId);
      if (String(fresh?.xVerification?.status || '').toLowerCase() !== 'pending') {
        continue;
      }

      const requestedRaw = normalizeXHandle(
        fresh.xVerification?.requestedHandle || fresh.xHandle || ''
      );
      const requestedLower = normalizeHandleCompare(requestedRaw);

      if (!requestedRaw || requestedLower !== senderUsername) {
        continue;
      }

      const code = String(fresh.xVerification?.verificationCode || '').trim();
      if (!code || !dmTextContainsCode(ev.text, code)) {
        continue;
      }

      completeXVerification(discordUserId, requestedRaw);

      if (typeof hooks.onVerified === 'function') {
        await hooks.onVerified({
          discordUserId: String(discordUserId),
          handle: requestedRaw,
          dmEventId: ev.id
        });
      }
    }
  }
}

/**
 * @param {import('discord.js').Client} client
 * @param {{ onVerified?: (args: { discordUserId: string, handle: string, dmEventId: string }) => Promise<void> | void, intervalMs?: number }} [options]
 * @returns {() => void} stop
 */
function startXDmVerificationPoller(client, options = {}) {
  const intervalMs = Math.max(60_000, Number(options.intervalMs) || 120_000);

  const tick = () => {
    runXDmVerificationPass(client, { onVerified: options.onVerified }).catch(err => {
      console.error('[XVerify/DM] Poll failed:', err?.message || err);
    });
  };

  const id = setInterval(tick, intervalMs);
  setTimeout(tick, 15_000);

  return () => clearInterval(id);
}

module.exports = {
  runXDmVerificationPass,
  startXDmVerificationPoller
};
