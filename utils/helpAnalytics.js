'use strict';

const fs = require('fs');
const path = require('path');

const ANALYTICS_PATH = path.join(__dirname, '..', 'data', 'helpAnalytics.json');

function defaultData() {
  return {
    version: 1,
    help_topic_requested: {},
    help_question_no_match: 0,
    help_topic_clicked: {},
    faq_opened: 0
  };
}

function readAnalytics() {
  try {
    if (!fs.existsSync(ANALYTICS_PATH)) {
      return defaultData();
    }
    const raw = fs.readFileSync(ANALYTICS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const base = defaultData();
    return {
      ...base,
      ...parsed,
      help_topic_requested: {
        ...base.help_topic_requested,
        ...(parsed.help_topic_requested && typeof parsed.help_topic_requested === 'object'
          ? parsed.help_topic_requested
          : {})
      },
      help_topic_clicked: {
        ...base.help_topic_clicked,
        ...(parsed.help_topic_clicked && typeof parsed.help_topic_clicked === 'object'
          ? parsed.help_topic_clicked
          : {})
      }
    };
  } catch {
    return defaultData();
  }
}

function writeAnalytics(data) {
  try {
    fs.mkdirSync(path.dirname(ANALYTICS_PATH), { recursive: true });
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[HelpAnalytics] write failed:', err?.message || err);
  }
}

/**
 * Stable key: optional `topic.id`, else trimmed `title`.
 * @param {object|null|undefined} topic
 * @returns {string}
 */
function getTopicKey(topic) {
  if (!topic || typeof topic !== 'object') return 'unknown';
  if (typeof topic.id === 'string' && topic.id.trim()) return topic.id.trim();
  const t = String(topic.title || '').trim();
  return t || 'unknown';
}

function schedule(fn) {
  setImmediate(() => {
    try {
      fn();
    } catch (_) {}
  });
}

function bumpMapCounter(mapName, topic) {
  const data = readAnalytics();
  if (!data[mapName] || typeof data[mapName] !== 'object') data[mapName] = {};
  const key = getTopicKey(topic);
  data[mapName][key] = Number(data[mapName][key] || 0) + 1;
  writeAnalytics(data);
}

/** !help <q> matched and topic content is being delivered. */
function recordHelpTopicRequested(topic) {
  schedule(() => bumpMapCounter('help_topic_requested', topic));
}

/** Interactive help: user picked a topic from the menu. */
function recordHelpTopicClicked(topic) {
  schedule(() => bumpMapCounter('help_topic_clicked', topic));
}

/** !help <q> had no match (before suggestions DM). */
function recordHelpQuestionNoMatch() {
  schedule(() => {
    try {
      const data = readAnalytics();
      data.help_question_no_match = Number(data.help_question_no_match || 0) + 1;
      writeAnalytics(data);
    } catch (_) {}
  });
}

/** !faq invoked. */
function recordFaqOpened() {
  schedule(() => {
    try {
      const data = readAnalytics();
      data.faq_opened = Number(data.faq_opened || 0) + 1;
      writeAnalytics(data);
    } catch (_) {}
  });
}

module.exports = {
  recordHelpTopicRequested,
  recordHelpTopicClicked,
  recordHelpQuestionNoMatch,
  recordFaqOpened,
  getTopicKey,
  readAnalytics
};
