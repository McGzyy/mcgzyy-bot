const fs = require('fs');
const path = require('path');

const userProfilesFilePath = path.join(__dirname, '../data/userProfiles.json');

/**
 * =========================
 * FILE HELPERS
 * =========================
 */

function ensureUserProfilesFile() {
  try {
    if (!fs.existsSync(userProfilesFilePath)) {
      fs.writeFileSync(userProfilesFilePath, JSON.stringify([], null, 2));
    }
  } catch (error) {
    console.error('[UserProfiles] Failed to ensure file:', error.message);
  }
}

function loadUserProfiles() {
  try {
    ensureUserProfilesFile();

    const rawData = fs.readFileSync(userProfilesFilePath, 'utf-8');
    const parsed = JSON.parse(rawData);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[UserProfiles] Failed to load profiles:', error.message);
    return [];
  }
}

function saveUserProfiles(profiles) {
  try {
    fs.writeFileSync(userProfilesFilePath, JSON.stringify(profiles, null, 2));
  } catch (error) {
    console.error('[UserProfiles] Failed to save profiles:', error.message);
  }
}

/**
 * =========================
 * BASIC HELPERS
 * =========================
 */

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

const CALLER_TRUST_LEVELS = ['none', 'approved', 'top_caller', 'trusted_pro', 'restricted'];

function normalizeCallerTrustLevel(level) {
  const raw = String(level || '').trim().toLowerCase();
  return CALLER_TRUST_LEVELS.includes(raw) ? raw : 'none';
}

function normalizeXHandle(value) {
  let raw = normalizeString(value);

  if (!raw) return '';

  // Reject Discord user/role/channel mentions entirely
  if (/^<[@#&!]/.test(raw)) return '';

  // Remove Discord angle brackets around links only
  raw = raw.replace(/^<|>$/g, '').trim();

  // Accept full X / Twitter URLs
  raw = raw.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '');
  raw = raw.replace(/^(www\.)?(x|twitter)\.com\//i, '');

  // Remove leading @
  raw = raw.replace(/^@+/, '');

  // Remove trailing slash / query / fragment / extra path
  raw = raw.split('/')[0];
  raw = raw.split('?')[0];
  raw = raw.split('#')[0];

  // Remove punctuation / spaces around pasted handles
  raw = raw.replace(/[^\w]/g, '');

  // Reject pure numeric IDs (likely Discord IDs, not X handles)
  if (/^\d+$/.test(raw)) return '';

  return raw.slice(0, 15);
}

function isLikelyXHandle(value) {
  const handle = normalizeXHandle(value);
  return /^[A-Za-z0-9_]{1,15}$/.test(handle);
}

function buildAliasSet(profile = {}) {
  const aliases = new Set();

  if (profile.discordUserId) aliases.add(`id:${profile.discordUserId}`);
  if (profile.username) aliases.add(`username:${normalizeLower(profile.username)}`);
  if (profile.displayName) aliases.add(`display:${normalizeLower(profile.displayName)}`);

  if (Array.isArray(profile.previousUsernames)) {
    for (const name of profile.previousUsernames) {
      if (name) aliases.add(`username:${normalizeLower(name)}`);
    }
  }

  if (Array.isArray(profile.previousDisplayNames)) {
    for (const name of profile.previousDisplayNames) {
      if (name) aliases.add(`display:${normalizeLower(name)}`);
    }
  }

  return Array.from(aliases);
}

function getDefaultPublicSettings() {
  return {
    publicCreditMode: 'discord_name', // 'anonymous' | 'discord_name' | 'verified_x_tag'
    allowPublicXTag: false,
    allowPublicDisplayName: true,
    publicAlias: ''
  };
}

function getDefaultPublicTracking() {
  return {
    mentionCountToday: 0,
    mentionCountDate: null,
    lastPublicMentionAt: null
  };
}

function getDefaultXVerification() {
  return {
    requestedHandle: '',
    requestedAt: null,
    verificationCode: '',
    status: 'none', // 'none' | 'pending' | 'verified' | 'denied'
    deniedAt: null,
    deniedReason: '',
    /** Mod review message (for centralized mod queue channels). */
    reviewChannelId: null,
    reviewMessageId: null,
    reviewPostedAt: null,
    reviewResolvedAt: null
  };
}

function getDefaultTopCallerReview() {
  return {
    dismissedUntil: null,
    reviewChannelId: null,
    reviewMessageId: null,
    reviewPostedAt: null,
    reviewResolvedAt: null
  };
}

/** Backfill member-oriented fields for legacy rows and after partial updates. */
function ensureMemberMetaShape(profile) {
  if (!profile || typeof profile !== 'object') return profile;

  if (profile.discordDisplayName == null || normalizeString(profile.discordDisplayName) === '') {
    profile.discordDisplayName = normalizeString(profile.displayName || '');
  }
  if (profile.joinedAt === undefined) profile.joinedAt = null;
  if (profile.lastSeenAt === undefined) profile.lastSeenAt = null;
  profile.guildMember = profile.guildMember === true;
  if (!Array.isArray(profile.rolesSnapshot)) profile.rolesSnapshot = [];
  if (profile.xVerifiedAt === undefined) profile.xVerifiedAt = null;
  if (profile.callerTrustLevel === undefined) profile.callerTrustLevel = 'none';
  if (profile.topCallerReview === undefined) profile.topCallerReview = getDefaultTopCallerReview();

  return profile;
}

function createEmptyProfile({
  discordUserId = null,
  username = '',
  displayName = ''
} = {}) {
  const now = new Date().toISOString();

  const disp = normalizeString(displayName);

  const profile = {
    discordUserId: discordUserId ? String(discordUserId) : null,
    username: normalizeString(username),
    displayName: disp,
    /** Guild server display name snapshot (kept in sync with displayName on upsert when provided). */
    discordDisplayName: disp,

    previousUsernames: [],
    previousDisplayNames: [],

    xHandle: '',
    verifiedXHandle: '',
    isXVerified: false,
    xVerification: getDefaultXVerification(),
    /** ISO time when X verification completed; set only when you extend verification flow. */
    xVerifiedAt: null,

    joinedAt: null,
    lastSeenAt: null,
    guildMember: false,
    rolesSnapshot: [],

    publicSettings: getDefaultPublicSettings(),
    publicTracking: getDefaultPublicTracking(),

    callerTrustLevel: 'none',
    topCallerReview: getDefaultTopCallerReview(),

    createdAt: now,
    updatedAt: now
  };

  profile.aliases = buildAliasSet(profile);

  return profile;
}

/**
 * =========================
 * FINDERS
 * =========================
 */

function getAllUserProfiles() {
  return loadUserProfiles();
}

function getCallerTrustLevel(discordUserId) {
  const profile = getUserProfileByDiscordId(discordUserId);
  return normalizeCallerTrustLevel(profile?.callerTrustLevel || 'none');
}

function setCallerTrustLevel(discordUserId, level) {
  const normalizedLevel = normalizeCallerTrustLevel(level);
  return updateUserProfile(discordUserId, { callerTrustLevel: normalizedLevel });
}

function isCallerApproved(discordUserId) {
  const level = getCallerTrustLevel(discordUserId);
  return level !== 'none' && level !== 'restricted';
}

function getUserProfileByDiscordId(discordUserId) {
  if (!discordUserId) return null;

  const profiles = loadUserProfiles();
  return profiles.find(
    profile => String(profile.discordUserId || '') === String(discordUserId)
  ) || null;
}

/**
 * Mod-verified X handle → profile (for future X mention intake / lookups).
 * If data ever contains duplicate verified handles, the first match wins.
 */
function getUserProfileByVerifiedXHandle(handle) {
  const h = normalizeXHandle(handle);
  if (!h) return null;

  const profiles = loadUserProfiles();
  return (
    profiles.find(
      profile =>
        profile.isXVerified === true &&
        normalizeXHandle(profile.verifiedXHandle || '') === h
    ) || null
  );
}

function getUserProfileByUsername(username) {
  const normalized = normalizeLower(username);
  if (!normalized) return null;

  const profiles = loadUserProfiles();

  return profiles.find(profile => {
    const aliases = Array.isArray(profile.aliases) ? profile.aliases : [];
    return aliases.includes(`username:${normalized}`);
  }) || null;
}

function getUserProfileByDisplayName(displayName) {
  const normalized = normalizeLower(displayName);
  if (!normalized) return null;

  const profiles = loadUserProfiles();

  return profiles.find(profile => {
    const aliases = Array.isArray(profile.aliases) ? profile.aliases : [];
    return aliases.includes(`display:${normalized}`);
  }) || null;
}

function findUserProfile({
  discordUserId = null,
  username = '',
  displayName = ''
} = {}) {
  if (discordUserId) {
    const byId = getUserProfileByDiscordId(discordUserId);
    if (byId) return byId;
  }

  if (username) {
    const byUsername = getUserProfileByUsername(username);
    if (byUsername) return byUsername;
  }

  if (displayName) {
    const byDisplayName = getUserProfileByDisplayName(displayName);
    if (byDisplayName) return byDisplayName;
  }

  return null;
}

/**
 * =========================
 * UPSERT / UPDATE
 * =========================
 */

function upsertUserProfile({
  discordUserId = null,
  username = '',
  displayName = ''
} = {}) {
  const profiles = loadUserProfiles();

  const normalizedDiscordId = discordUserId ? String(discordUserId) : null;
  const normalizedUsername = normalizeString(username);
  const normalizedDisplayName = normalizeString(displayName);

  let existingIndex = profiles.findIndex(
    profile => String(profile.discordUserId || '') === String(normalizedDiscordId || '')
  );

  if (existingIndex === -1 && normalizedUsername) {
    existingIndex = profiles.findIndex(profile => {
      const aliases = Array.isArray(profile.aliases) ? profile.aliases : [];
      return aliases.includes(`username:${normalizeLower(normalizedUsername)}`);
    });
  }

  if (existingIndex === -1 && normalizedDisplayName) {
    existingIndex = profiles.findIndex(profile => {
      const aliases = Array.isArray(profile.aliases) ? profile.aliases : [];
      return aliases.includes(`display:${normalizeLower(normalizedDisplayName)}`);
    });
  }

  if (existingIndex === -1) {
    const newProfile = createEmptyProfile({
      discordUserId: normalizedDiscordId,
      username: normalizedUsername,
      displayName: normalizedDisplayName
    });
    ensureMemberMetaShape(newProfile);
    newProfile.aliases = buildAliasSet(newProfile);

    profiles.push(newProfile);
    saveUserProfiles(profiles);
    return newProfile;
  }

  const existing = profiles[existingIndex];

  const previousUsernames = Array.isArray(existing.previousUsernames)
    ? [...existing.previousUsernames]
    : [];

  const previousDisplayNames = Array.isArray(existing.previousDisplayNames)
    ? [...existing.previousDisplayNames]
    : [];

  if (
    existing.username &&
    normalizedUsername &&
    existing.username !== normalizedUsername &&
    !previousUsernames.includes(existing.username)
  ) {
    previousUsernames.push(existing.username);
  }

  if (
    existing.displayName &&
    normalizedDisplayName &&
    existing.displayName !== normalizedDisplayName &&
    !previousDisplayNames.includes(existing.displayName)
  ) {
    previousDisplayNames.push(existing.displayName);
  }

  const updated = {
    ...existing,
    discordUserId: normalizedDiscordId || existing.discordUserId || null,
    username: normalizedUsername || existing.username || '',
    displayName: normalizedDisplayName || existing.displayName || '',
    discordDisplayName:
      normalizedDisplayName ||
      normalizeString(existing.discordDisplayName || '') ||
      existing.displayName ||
      '',
    previousUsernames,
    previousDisplayNames,
    joinedAt: existing.joinedAt ?? null,
    lastSeenAt: existing.lastSeenAt ?? null,
    guildMember: existing.guildMember === true,
    rolesSnapshot: Array.isArray(existing.rolesSnapshot) ? [...existing.rolesSnapshot] : [],
    xVerifiedAt: existing.xVerifiedAt != null ? existing.xVerifiedAt : null,
    xHandle: normalizeXHandle(existing.xHandle || ''),
    verifiedXHandle: normalizeXHandle(existing.verifiedXHandle || ''),
    isXVerified: !!existing.isXVerified,
    xVerification: {
      ...getDefaultXVerification(),
      ...(existing.xVerification || {}),
      requestedHandle: normalizeXHandle(existing?.xVerification?.requestedHandle || '')
    },
    publicSettings: {
      ...getDefaultPublicSettings(),
      ...(existing.publicSettings || {})
    },
    publicTracking: {
      ...getDefaultPublicTracking(),
      ...(existing.publicTracking || {})
    },
    updatedAt: new Date().toISOString()
  };

  ensureMemberMetaShape(updated);
  updated.aliases = buildAliasSet(updated);

  profiles[existingIndex] = updated;
  saveUserProfiles(profiles);

  return updated;
}

function updateUserProfile(discordUserId, updates = {}) {
  if (!discordUserId) return null;

  const profiles = loadUserProfiles();
  const index = profiles.findIndex(
    profile => String(profile.discordUserId || '') === String(discordUserId)
  );

  if (index === -1) return null;

  const existing = profiles[index];

  const updated = {
    ...existing,
    ...updates,
    xHandle: normalizeXHandle(updates.xHandle ?? existing.xHandle ?? ''),
    verifiedXHandle: normalizeXHandle(updates.verifiedXHandle ?? existing.verifiedXHandle ?? ''),
    isXVerified: updates.isXVerified ?? existing.isXVerified ?? false,
    xVerification: {
      ...getDefaultXVerification(),
      ...(existing.xVerification || {}),
      ...(updates.xVerification || {}),
      requestedHandle: normalizeXHandle(
        updates?.xVerification?.requestedHandle ??
        existing?.xVerification?.requestedHandle ??
        ''
      ),
      verificationCode:
        updates?.xVerification?.verificationCode ??
        existing?.xVerification?.verificationCode ??
        '',
      status:
        updates?.xVerification?.status ??
        existing?.xVerification?.status ??
        'none'
    },
    topCallerReview: {
      ...getDefaultTopCallerReview(),
      ...(existing.topCallerReview || {}),
      ...(updates.topCallerReview || {})
    },
    publicSettings: {
      ...getDefaultPublicSettings(),
      ...(existing.publicSettings || {}),
      ...(updates.publicSettings || {})
    },
    publicTracking: {
      ...getDefaultPublicTracking(),
      ...(existing.publicTracking || {}),
      ...(updates.publicTracking || {})
    },
    updatedAt: new Date().toISOString()
  };

  ensureMemberMetaShape(updated);
  updated.aliases = buildAliasSet(updated);

  profiles[index] = updated;
  saveUserProfiles(profiles);

  return updated;
}

function snapshotGuildRoleIds(member) {
  if (!member?.roles?.cache) return [];
  return member.roles.cache
    .filter(role => role.id !== member.guild?.id)
    .map(role => role.id)
    .slice(0, 50);
}

/**
 * Build a new lightweight guild-member profile object (does not save). Caller must ensure id not already stored.
 */
function buildMissingGuildMemberProfile(member, { joinedAtIso, lastSeenAtIso }) {
  if (!member?.user || member.user.bot) return null;

  const id = String(member.user.id);
  const discordDisplay =
    normalizeString(member.displayName) ||
    normalizeString(member.user.globalName) ||
    normalizeString(member.user.username) ||
    '';

  const profile = createEmptyProfile({
    discordUserId: id,
    username: member.user.username || '',
    displayName: discordDisplay
  });

  profile.discordDisplayName = discordDisplay;
  profile.joinedAt = joinedAtIso;
  profile.lastSeenAt = lastSeenAtIso;
  profile.guildMember = true;
  profile.rolesSnapshot = snapshotGuildRoleIds(member);
  profile.xVerifiedAt = null;

  ensureMemberMetaShape(profile);
  profile.aliases = buildAliasSet(profile);

  return profile;
}

/**
 * Create a minimal profile when a user joins the server. No-op if a profile already exists for that Discord id.
 */
function ensureUserProfileOnGuildJoin(member) {
  try {
    if (!member?.user || member.user.bot) return null;

    const id = String(member.user.id);
    if (getUserProfileByDiscordId(id)) return null;

    const now = new Date().toISOString();
    const profile = buildMissingGuildMemberProfile(member, {
      joinedAtIso: now,
      lastSeenAtIso: now
    });
    if (!profile) return null;

    const profiles = loadUserProfiles();
    profiles.push(profile);
    saveUserProfiles(profiles);

    return profile;
  } catch (error) {
    console.error('[UserProfiles] ensureUserProfileOnGuildJoin failed:', error.message);
    return null;
  }
}

/**
 * Count humans missing profiles (after refreshing member cache). Does not write.
 */
async function previewMemberProfileBackfill(guild) {
  if (!guild) {
    return { error: 'no_guild', totalHumans: 0, missing: 0, skippedBots: 0 };
  }

  await guild.members.fetch().catch(err => {
    console.error('[UserProfiles] previewMemberProfileBackfill fetch failed:', err.message);
  });

  const profiles = loadUserProfiles();
  const existing = new Set(
    profiles.map(p => String(p.discordUserId || '')).filter(Boolean)
  );

  let skippedBots = 0;
  let totalHumans = 0;
  let missing = 0;

  for (const member of guild.members.cache.values()) {
    if (member.user?.bot) {
      skippedBots++;
      continue;
    }
    totalHumans++;
    if (!existing.has(String(member.user.id))) {
      missing++;
    }
  }

  return { totalHumans, missing, skippedBots };
}

/**
 * One-shot create missing member profiles (same shape as join). Single save at end.
 * @param {import('discord.js').Guild} guild
 */
async function runMemberProfileBackfill(guild) {
  if (!guild) {
    return { error: 'no_guild', created: 0, totalHumans: 0, hadProfile: 0, skippedBots: 0 };
  }

  await guild.members.fetch().catch(err => {
    console.error('[UserProfiles] runMemberProfileBackfill fetch failed:', err.message);
  });

  const profiles = loadUserProfiles();
  const existing = new Set(
    profiles.map(p => String(p.discordUserId || '')).filter(Boolean)
  );

  const now = new Date().toISOString();
  let skippedBots = 0;
  let totalHumans = 0;
  const toAdd = [];

  for (const member of guild.members.cache.values()) {
    if (member.user?.bot) {
      skippedBots++;
      continue;
    }
    totalHumans++;
    const id = String(member.user.id);
    if (existing.has(id)) continue;

    const joinedIso =
      member.joinedAt instanceof Date && !Number.isNaN(member.joinedAt.getTime())
        ? member.joinedAt.toISOString()
        : now;

    const profile = buildMissingGuildMemberProfile(member, {
      joinedAtIso: joinedIso,
      lastSeenAtIso: now
    });
    if (profile) {
      toAdd.push(profile);
      existing.add(id);
    }
  }

  if (toAdd.length) {
    profiles.push(...toAdd);
    saveUserProfiles(profiles);
  }

  return {
    created: toAdd.length,
    totalHumans,
    hadProfile: totalHumans - toAdd.length,
    skippedBots
  };
}

/**
 * =========================
 * INDEX.JS COMPAT HELPERS
 * =========================
 */

function setPublicCreditMode(discordUserId, mode = 'discord_name') {
  const normalizedMode =
    mode === 'anonymous'
      ? 'anonymous'
      : mode === 'verified_x_tag'
      ? 'verified_x_tag'
      : 'discord_name';

  return updateUserProfile(discordUserId, {
    publicSettings: {
      publicCreditMode: normalizedMode,
      allowPublicXTag: normalizedMode === 'verified_x_tag',
      allowPublicDisplayName: normalizedMode !== 'anonymous'
    }
  });
}

function startXVerification(discordUserId, handle, verificationCode = '') {
  const normalizedHandle = normalizeXHandle(handle);

  return updateUserProfile(discordUserId, {
    xHandle: normalizedHandle,
    xVerification: {
      requestedHandle: normalizedHandle,
      requestedAt: new Date().toISOString(),
      verificationCode,
      status: 'pending',
      deniedAt: null,
      deniedReason: '',
      reviewChannelId: null,
      reviewMessageId: null,
      reviewPostedAt: null,
      reviewResolvedAt: null
    }
  });
}

function completeXVerification(discordUserId, handle) {
  const normalizedHandle = normalizeXHandle(handle);

  return updateUserProfile(discordUserId, {
    xHandle: normalizedHandle,
    verifiedXHandle: normalizedHandle,
    isXVerified: true,
    xVerification: {
      requestedHandle: normalizedHandle,
      requestedAt: new Date().toISOString(),
      verificationCode: '',
      status: 'verified',
      reviewResolvedAt: new Date().toISOString()
    },
    publicSettings: {
      allowPublicXTag: true
    }
  });
}

/**
 * Persist a mod denial. Clears pending queue eligibility and unblocks a new request.
 */
function denyXVerification(discordUserId, handle, reason = '') {
  const profile = getUserProfileByDiscordId(discordUserId);
  if (!profile) return null;
  if (profile.isXVerified) return null;
  if (String(profile.xVerification?.status || '').toLowerCase() !== 'pending') {
    return null;
  }

  const existingV = profile.xVerification || {};
  const reqHandle = normalizeXHandle(
    existingV.requestedHandle || normalizeXHandle(handle) || ''
  );

  return updateUserProfile(discordUserId, {
    xHandle: '',
    isXVerified: false,
    verifiedXHandle: normalizeXHandle(profile.verifiedXHandle || ''),
    xVerification: {
      requestedHandle: reqHandle,
      requestedAt: existingV.requestedAt || null,
      verificationCode: '',
      status: 'denied',
      deniedAt: new Date().toISOString(),
      deniedReason: String(reason || '').trim().slice(0, 500),
      reviewResolvedAt: new Date().toISOString()
    }
  });
}

function setXVerificationReviewMessageMeta(discordUserId, { channelId = null, messageId = null } = {}) {
  if (!discordUserId) return null;
  return updateUserProfile(discordUserId, {
    xVerification: {
      reviewChannelId: channelId ? String(channelId) : null,
      reviewMessageId: messageId ? String(messageId) : null,
      reviewPostedAt: new Date().toISOString()
    }
  });
}

function clearXVerificationReviewMessageMeta(discordUserId) {
  if (!discordUserId) return null;
  return updateUserProfile(discordUserId, {
    xVerification: {
      reviewChannelId: null,
      reviewMessageId: null,
      reviewPostedAt: null
    }
  });
}

function setTopCallerReviewMessageMeta(discordUserId, { channelId = null, messageId = null } = {}) {
  if (!discordUserId) return null;
  return updateUserProfile(discordUserId, {
    topCallerReview: {
      reviewChannelId: channelId ? String(channelId) : null,
      reviewMessageId: messageId ? String(messageId) : null,
      reviewPostedAt: new Date().toISOString()
    }
  });
}

function clearTopCallerReviewMessageMeta(discordUserId) {
  if (!discordUserId) return null;
  return updateUserProfile(discordUserId, {
    topCallerReview: {
      reviewChannelId: null,
      reviewMessageId: null,
      reviewPostedAt: null
    }
  });
}

function dismissTopCallerCandidate(discordUserId, days = 7) {
  if (!discordUserId) return null;
  const until = new Date(Date.now() + Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000).toISOString();
  return updateUserProfile(discordUserId, {
    topCallerReview: {
      dismissedUntil: until,
      reviewResolvedAt: new Date().toISOString()
    }
  });
}

function resolveTopCallerReview(discordUserId) {
  if (!discordUserId) return null;
  return updateUserProfile(discordUserId, {
    topCallerReview: {
      reviewResolvedAt: new Date().toISOString()
    }
  });
}

function getPreferredPublicName(profile = {}) {
  const mode = String(
    profile?.publicSettings?.publicCreditMode || 'discord_name'
  ).toLowerCase();

  if (mode === 'anonymous') {
    return 'Anonymous';
  }

  if (
    mode === 'verified_x_tag' &&
    profile?.isXVerified === true &&
    profile?.publicSettings?.allowPublicXTag === true
  ) {
    const verifiedHandle = normalizeXHandle(
      profile?.verifiedXHandle ||
      profile?.xVerification?.requestedHandle ||
      profile?.xHandle ||
      ''
    );

    if (verifiedHandle) return `@${verifiedHandle}`;
  }

  return (
    normalizeString(profile?.publicSettings?.publicAlias) ||
    normalizeString(profile?.displayName) ||
    normalizeString(profile?.username) ||
    'Anonymous'
  );
}

/**
 * =========================
 * PUBLIC IDENTITY HELPERS
 * =========================
 */

function buildAnonymousLabel() {
  return 'Anonymous';
}

function buildDiscordPublicLabel(profile = {}, fallback = {}) {
  const alias = normalizeString(profile?.publicSettings?.publicAlias || '');
  if (alias) return alias;

  if (profile?.publicSettings?.allowPublicDisplayName !== false) {
    const display =
      normalizeString(profile?.displayName) ||
      normalizeString(fallback.displayName) ||
      normalizeString(profile?.username) ||
      normalizeString(fallback.username);

    if (display) return display;
  }

  const username =
    normalizeString(profile?.username) ||
    normalizeString(fallback.username) ||
    normalizeString(profile?.displayName) ||
    normalizeString(fallback.displayName);

  return username || buildAnonymousLabel();
}

function buildVerifiedXPublicLabel(profile = {}, fallback = {}) {
  const verifiedHandle = normalizeXHandle(profile?.verifiedXHandle || '');
  const requestedHandle = normalizeXHandle(profile?.xVerification?.requestedHandle || '');
  const xHandle = normalizeXHandle(profile?.xHandle || '');

  const canUseVerifiedX =
    profile?.isXVerified === true &&
    profile?.publicSettings?.allowPublicXTag === true;

  if (canUseVerifiedX) {
    const handle = verifiedHandle || requestedHandle || xHandle;
    if (handle) return `@${handle}`;
  }

  return buildDiscordPublicLabel(profile, fallback);
}

function resolvePublicCallerName({
  discordUserId = null,
  username = '',
  displayName = '',
  trackedCall = null,
  fallback = 'Unknown'
} = {}) {
  const fallbackData = {
    username:
      normalizeString(username) ||
      normalizeString(trackedCall?.firstCallerUsername) ||
      '',
    displayName:
      normalizeString(displayName) ||
      normalizeString(trackedCall?.firstCallerDisplayName) ||
      ''
  };

  const profile = findUserProfile({
    discordUserId: discordUserId || trackedCall?.firstCallerDiscordId || trackedCall?.firstCallerId || null,
    username: fallbackData.username,
    displayName: fallbackData.displayName
  });

  const mode = String(
    profile?.publicSettings?.publicCreditMode ||
    'discord_name'
  ).toLowerCase();

  const sourceType = String(trackedCall?.callSourceType || '').toLowerCase();
const callerId = String(
  discordUserId ||
  trackedCall?.firstCallerDiscordId ||
  trackedCall?.firstCallerId ||
  ''
).toUpperCase();

if (sourceType === 'bot_call' || callerId === 'MCGBOT_AUTO' || callerId === 'AUTO_BOT') {
  return 'McGBot';
}

if (sourceType === 'watch_only') {
  return 'No caller credit';
}

  let publicName = '';

  if (mode === 'anonymous') {
    publicName = buildAnonymousLabel();
  } else if (mode === 'verified_x_tag') {
    publicName = buildVerifiedXPublicLabel(profile, fallbackData);
  } else {
    publicName = buildDiscordPublicLabel(profile, fallbackData);
  }

  return normalizeString(publicName) || fallback;
}

function getPendingXVerifications(limit = 10) {
  const profiles = loadUserProfiles();

  return profiles
    .filter(profile => String(profile?.xVerification?.status || '').toLowerCase() === 'pending')
    .sort((a, b) => {
      const aTime = new Date(a?.xVerification?.requestedAt || 0).getTime();
      const bTime = new Date(b?.xVerification?.requestedAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);
}

function getPublicCallerIdentity({
  discordUserId = null,
  username = '',
  displayName = '',
  trackedCall = null
} = {}) {
  const fallbackData = {
    username:
      normalizeString(username) ||
      normalizeString(trackedCall?.firstCallerUsername) ||
      '',
    displayName:
      normalizeString(displayName) ||
      normalizeString(trackedCall?.firstCallerDisplayName) ||
      ''
  };

  const profile = findUserProfile({
    discordUserId: discordUserId || trackedCall?.firstCallerDiscordId || trackedCall?.firstCallerId || null,
    username: fallbackData.username,
    displayName: fallbackData.displayName
  });

  const publicName = resolvePublicCallerName({
    discordUserId,
    username,
    displayName,
    trackedCall,
    fallback: 'Unknown'
  });

  const mode = String(
    profile?.publicSettings?.publicCreditMode ||
    'discord_name'
  ).toLowerCase();

  const verifiedHandle = normalizeXHandle(profile?.verifiedXHandle || '');
  const canUseVerifiedX =
    profile?.isXVerified === true &&
    profile?.publicSettings?.allowPublicXTag === true &&
    !!verifiedHandle;

  return {
    publicName,
    mode,
    isAnonymous: mode === 'anonymous',
    isVerifiedX: canUseVerifiedX,
    verifiedXHandle: canUseVerifiedX ? verifiedHandle : '',
    discordUserId: profile?.discordUserId || discordUserId || trackedCall?.firstCallerDiscordId || trackedCall?.firstCallerId || null,
    username: profile?.username || fallbackData.username || '',
    displayName: profile?.displayName || fallbackData.displayName || '',
    profile
  };
}

/**
 * =========================
 * EXPORTS
 * =========================
 */

module.exports = {
  // basic helpers
  normalizeXHandle,
  isLikelyXHandle,

  // profile CRUD
  getAllUserProfiles,
  getUserProfileByDiscordId,
  getUserProfileByVerifiedXHandle,
  getUserProfileByUsername,
  getUserProfileByDisplayName,
  findUserProfile,
  upsertUserProfile,
  updateUserProfile,
  ensureUserProfileOnGuildJoin,
  previewMemberProfileBackfill,
  runMemberProfileBackfill,

   // x verification
  getPendingXVerifications,

  // index.js compatibility
  setPublicCreditMode,
  startXVerification,
  completeXVerification,
  denyXVerification,
  setXVerificationReviewMessageMeta,
  clearXVerificationReviewMessageMeta,
  getPreferredPublicName,
  setTopCallerReviewMessageMeta,
  clearTopCallerReviewMessageMeta,
  dismissTopCallerCandidate,
  resolveTopCallerReview,

  // public identity
  resolvePublicCallerName,
  getPublicCallerIdentity,

  // caller trust
  CALLER_TRUST_LEVELS,
  normalizeCallerTrustLevel,
  getCallerTrustLevel,
  setCallerTrustLevel,
  isCallerApproved
};