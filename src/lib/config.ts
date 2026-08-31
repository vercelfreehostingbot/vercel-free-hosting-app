// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — CONFIGURATION
// =================================================================

// Dynamic runtime configuration overrides
let dynamicBotToken: string | null = null;
let dynamicBotUsername: string | null = null;
let dynamicBotName: string | null = null;
let dynamicDailyLimit: number | null = null;
let dynamicChannelId: string | null = null;
let dynamicGroupId: string | null = null;
let dynamicAppUrl: string | null = null;

export const CONFIG = {
  get BOT_NAME(): string {
    return dynamicBotName || '𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧';
  },
  get BOT_USERNAME(): string {
    return dynamicBotUsername || process.env.BOT_USERNAME || 'Vercel_Free_Hosting_Bot';
  },
  SUPER_ADMIN_ID: 6919025708,
  get DEFAULT_DAILY_LIMIT(): number {
    return dynamicDailyLimit ?? 5;
  },
  MAX_ZIP_SIZE_MB: 50,
  MAX_EXTRACT_SIZE_MB: 120,
  MAX_FILE_COUNT: 4000,
  DEPLOYMENT_TIMEOUT_MS: 300000, // 5 minutes

  // Telegram credentials
  get BOT_TOKEN(): string {
    return dynamicBotToken || process.env.BOT_TOKEN || '8811237049:AAEEPMk7jmgVaaQi5FnOlUh8v64rxnfP-Ao';
  },
  get TELEGRAM_WEBHOOK_SECRET(): string {
    return process.env.TELEGRAM_WEBHOOK_SECRET || '';
  },

  // Force Join Channels
  get CHANNEL_ID(): string {
    return dynamicChannelId || process.env.CHANNEL_ID || '';
  },
  get GROUP_ID(): string {
    return dynamicGroupId || process.env.GROUP_ID || '';
  },
  get CHANNEL_USERNAME(): string {
    return (process.env.CHANNEL_USERNAME || '').replace('@', '');
  },
  get GROUP_USERNAME(): string {
    return (process.env.GROUP_USERNAME || '').replace('@', '');
  },

  // GitHub Credentials
  get GITHUB_TOKEN(): string {
    return process.env.GITHUB_TOKEN || '';
  },
  get GITHUB_USERNAME(): string {
    return process.env.GITHUB_USERNAME || '';
  },

  // Vercel Credentials
  get VERCEL_TOKEN(): string {
    return process.env.VERCEL_TOKEN || '';
  },
  get VERCEL_TEAM_ID(): string {
    return process.env.VERCEL_TEAM_ID || '';
  },

  // Firebase
  get FIREBASE_PROJECT_ID(): string {
    return process.env.FIREBASE_PROJECT_ID || '';
  },
  get FIREBASE_CLIENT_EMAIL(): string {
    return process.env.FIREBASE_CLIENT_EMAIL || '';
  },
  get FIREBASE_PRIVATE_KEY(): string {
    let key = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1);
    }
    return key.replace(/\\n/g, '\n').replace(/\\\\n/g, '\n');
  },

  // App URL
  get APP_URL(): string {
    return dynamicAppUrl || 'https://free-hosting-bot.ai.studio';
  },
};

/**
 * Updates App URL (Webhook Base URL)
 */
export function setDynamicAppUrl(url: string) {
  let clean = url.trim();
  if (clean && !clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `https://${clean}`;
  }
  clean = clean.replace(/\/+$/, '');
  dynamicAppUrl = clean;
}

/**
 * Updates Bot Token and optionally restarts poller
 */
export function setDynamicBotToken(token: string, username?: string, name?: string) {
  dynamicBotToken = token.trim();
  if (username) dynamicBotUsername = username.replace(/^@/, '').trim();
  if (name) dynamicBotName = name.trim();
}

/**
 * Updates Force Join Channel & Group IDs
 */
export function setDynamicForceJoin(channelId?: string, groupId?: string) {
  if (channelId !== undefined) dynamicChannelId = channelId.trim();
  if (groupId !== undefined) dynamicGroupId = groupId.trim();
}

/**
 * Updates Default Daily Build Limit
 */
export function setDynamicDailyLimit(limit: number) {
  if (!isNaN(limit) && limit > 0) {
    dynamicDailyLimit = limit;
  }
}

export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

