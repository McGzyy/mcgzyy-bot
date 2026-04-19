const path = require('path');
const { readJson, writeJson } = require('./jsonStore');

const userProfilesFilePath = path.join(__dirname, '../data/userProfiles.json');

/** @type {unknown[]} */
let _profilesStore = [];
let _userProfilesHydrated = false;

/**
 * =========================
 * FILE HELPERS
 * =========================
 */

async function initUserProfilesStore() {
  if (_userProfilesHydrated) return;
  _userProfilesHydrated = true;
  try {
    const parsed = await readJson(userProfilesFilePath);
    _profilesStore = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const code = error && /** @type {{ code?: string }} */ (error).code;
    if (code === 'ENOENT') {
      await writeJson(userProfilesFilePath, []);
      _profilesStore = [];
    } else if (error instanceof SyntaxError) {
      console.error('[UserProfiles] Invalid JSON in userProfiles.json:', error.message);
      _profilesStore = [];
    } else {
      console.error('[UserProfiles] Failed to load profiles:', /** @type {Error} */ (error).message);
      _profilesStore = [];
    }
  }
}

function loadUserProfiles() {
  if (!_userProfilesHydrated) {
    throw new Error('[UserProfiles] initUserProfilesStore() must be awaited before use');
  }
  try {
    return Array.isArray(_profilesStore) ? _profilesStore : [];
  } catch (error) {
    console.error('[UserProfiles] Failed to load profiles:', /** @type {Error} */ (error).message);
    return [];
  }
}

function saveUserProfiles(profiles) {
  if (!_userProfilesHydrated) {
    throw new Error('[UserProfiles] initUserProfilesStore() must be awaited before use');
  }
  try {
    _profilesStore = Array.isArray(profiles) ? profiles : [];
    writeJson(userProfilesFilePath, _profilesStore).catch((error) => {
      console.error('[UserProfiles] Failed to save profiles:', /** @type {Error} */ (error).message);
    });
  } catch (error) {
    console.error('[UserProfiles] Failed to save profiles:', /** @type {Error} */ (error).message);
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
    status: 'none' // 'none' | 'pending' | 'verified' | 'denied'
  };
}

function createEmptyProfile({
  discordUserId = null,
  username = '',
  displayName = ''
} = {}) {
  const now = new Date().toISOString();

  const profile = {
    discordUserId: discordUserId ? String(discordUserId) : null,
    username: normalizeString(username),
    displayName: normalizeString(displayName),

    previousUsernames: [],
    previousDisplayNames: [],

    xHandle: '',
    verifiedXHandle: '',
    isXVerified: false,
    xVerification: getDefaultXVerification(),

    publicSettings: getDefaultPublicSettings(),
    publicTracking: getDefaultPublicTracking(),

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

function getUserProfileByDiscordId(discordUserId) {
  if (!discordUserId) return null;

  const profiles = loadUserProfiles();
  return profiles.find(
    profile => String(profile.discordUserId || '') === String(discordUserId)
  ) || null;
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
    previousUsernames,
    previousDisplayNames,
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

  updated.aliases = buildAliasSet(updated);

  profiles[index] = updated;
  saveUserProfiles(profiles);

  return updated;
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
      deniedReason: ''
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
      status: 'verified'
    },
    publicSettings: {
      allowPublicXTag: true
    }
  });
}

/**
 * Remove linked X account (OAuth unlink / dashboard).
 */
function clearXAccountLink(discordUserId) {
  if (!discordUserId) return null;
  const profile = getUserProfileByDiscordId(discordUserId);
  if (!profile) return null;

  return updateUserProfile(discordUserId, {
    xHandle: '',
    verifiedXHandle: '',
    isXVerified: false,
    xVerification: getDefaultXVerification(),
    publicSettings: {
      ...getDefaultPublicSettings(),
      ...(profile.publicSettings || {}),
      allowPublicXTag: false
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
      deniedReason: String(reason || '').trim().slice(0, 500)
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
  initUserProfilesStore,
  // basic helpers
  normalizeXHandle,
  isLikelyXHandle,

  // profile CRUD
  getAllUserProfiles,
  getUserProfileByDiscordId,
  getUserProfileByUsername,
  getUserProfileByDisplayName,
  findUserProfile,
  upsertUserProfile,
  updateUserProfile,

  // index.js compatibility
  setPublicCreditMode,
  startXVerification,
  completeXVerification,
  clearXAccountLink,
  denyXVerification,
  getPreferredPublicName,

  // public identity
  resolvePublicCallerName,
  getPublicCallerIdentity
};