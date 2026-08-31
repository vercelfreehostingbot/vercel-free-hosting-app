// =================================================================
// 🛡️ 24/7 SELF-HEALING TELEGRAM BOT & WEBHOOK WATCHDOG
// Ensures the Telegram Webhook and Bot NEVER go down, auto-recovering
// =================================================================

import { CONFIG } from './config';
import { setTelegramWebhook, getTelegramWebhookInfo, getTelegramMe } from './telegram';
import { startPolling, stopPolling } from '../bot/polling';

const TARGET_WEBHOOK_URL = 'https://free-hosting-bot.ai.studio/api/telegram-webhook';
const WATCHDOG_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

let watchdogTimer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;
let lastHeartbeat = Date.now();

/**
 * Ensures the target webhook is registered with Telegram.
 * If webhook registration succeeds, Long Polling is put on standby.
 * If webhook registration fails, Long Polling is activated as failover.
 */
export async function ensureWebhookActive(): Promise<boolean> {
  if (!CONFIG.BOT_TOKEN) {
    console.warn('[WATCHDOG] ⚠️ Bot token not configured yet. Skipping webhook sync.');
    return false;
  }

  try {
    const info = await getTelegramWebhookInfo();
    const currentUrl = info?.result?.url || '';

    // Check if webhook is already set to the permanent URL
    if (info?.ok && currentUrl === TARGET_WEBHOOK_URL) {
      lastHeartbeat = Date.now();
      consecutiveFailures = 0;
      // Webhook is healthy, ensure polling is stopped so no 409 conflict happens
      stopPolling();
      return true;
    }

    console.log(`[WATCHDOG] 🔄 Webhook url is currently '${currentUrl}'. Auto-configuring permanent webhook: ${TARGET_WEBHOOK_URL}...`);
    const setRes = await setTelegramWebhook(TARGET_WEBHOOK_URL);

    if (setRes.ok) {
      console.log(`[WATCHDOG] ✅ Webhook successfully locked & verified on Telegram: ${TARGET_WEBHOOK_URL}`);
      stopPolling();
      consecutiveFailures = 0;
      lastHeartbeat = Date.now();
      return true;
    } else {
      console.warn(`[WATCHDOG] ⚠️ Webhook setup returned error: ${setRes.description}. Activating failover poller.`);
      consecutiveFailures++;
      startPolling().catch(() => {});
      return false;
    }
  } catch (error: any) {
    consecutiveFailures++;
    console.error(`[WATCHDOG] ❌ Webhook check exception: ${error?.message || error}`);
    // Failover: ensure bot is running even if webhook endpoint check has issues
    if (consecutiveFailures >= 2) {
      startPolling().catch(() => {});
    }
    return false;
  }
}

/**
 * Initializes 24/7 Watchdog daemon
 */
export function startBotWatchdog(): void {
  if (watchdogTimer) return;

  console.log('[WATCHDOG] 🛡️ Starting 24/7 High-Availability Bot Watchdog daemon...');

  // 1. Run immediately on server boot
  ensureWebhookActive().catch((err) => {
    console.error('[WATCHDOG] Initial webhook sync error:', err);
  });

  // 2. Periodic self-healing interval
  watchdogTimer = setInterval(async () => {
    lastHeartbeat = Date.now();
    try {
      await ensureWebhookActive();
    } catch (err: any) {
      console.error('[WATCHDOG] Periodic check error:', err?.message || err);
    }
  }, WATCHDOG_INTERVAL_MS);

  // Unref timer so it doesn't block graceful exits if needed
  if (watchdogTimer && typeof watchdogTimer.unref === 'function') {
    watchdogTimer.unref();
  }
}

/**
 * Returns Watchdog Health Status
 */
export function getWatchdogStatus() {
  return {
    target_webhook: TARGET_WEBHOOK_URL,
    last_heartbeat: lastHeartbeat,
    consecutive_failures: consecutiveFailures,
    is_active: Boolean(watchdogTimer),
    mode: '24/7_PERMANENT_SELF_HEALING',
  };
}
