// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — TELEGRAM LONG POLLING ENGINE
// =================================================================

import { processTelegramUpdate } from './index';
import { CONFIG, setDynamicBotToken } from '../lib/config';
import { getTelegramMe, getTelegramWebhookInfo } from '../lib/telegram';

let isPolling = false;
let shouldStopPolling = false;
let lastUpdateId = 0;
let pollAbortController: AbortController | null = null;

/**
 * Starts Telegram long-polling loop if no webhook is active.
 * If a webhook is registered on Telegram, polling will stand down automatically.
 */
export async function startPolling(): Promise<void> {
  const token = CONFIG.BOT_TOKEN;
  if (!token) {
    console.warn('[POLLING] Cannot start polling: No BOT_TOKEN configured.');
    return;
  }

  if (isPolling) {
    console.log('[POLLING] Telegram Poller is already active.');
    return;
  }

  // Check if a Webhook is active on Telegram first
  try {
    const webhookInfo = await getTelegramWebhookInfo();
    if (webhookInfo?.ok && webhookInfo.result?.url) {
      console.log(`[POLLING] ℹ️ Webhook is active (${webhookInfo.result.url}). Standby mode enabled; polling will not run.`);
      isPolling = false;
      return;
    }
  } catch (err: any) {
    console.warn('[POLLING] Could not check webhook status before starting:', err.message);
  }

  isPolling = true;
  shouldStopPolling = false;
  console.log(`[POLLING] 🚀 Starting Telegram Long Poller for bot...`);

  // Dynamically resolve actual bot identity from Telegram API
  try {
    const meRes = await getTelegramMe();
    if (meRes.ok && meRes.result) {
      setDynamicBotToken(token, meRes.result.username, meRes.result.first_name);
      console.log(`[POLLING] Connected to Telegram Bot: @${meRes.result.username} (${meRes.result.first_name})`);
    }
  } catch (err: any) {
    console.warn('[POLLING] Could not fetch bot identity from Telegram:', err.message);
  }

  // Polling loop
  (async () => {
    let consecutiveErrors = 0;

    while (!shouldStopPolling) {
      try {
        pollAbortController = new AbortController();
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=20&allowed_updates=["message","callback_query"]`;
        const res = await fetch(url, { signal: pollAbortController.signal });
        
        if (!res.ok) {
          const text = await res.text();
          consecutiveErrors++;

          if (res.status === 409) {
            // Check if webhook became active or another instance is running
            const wh = await getTelegramWebhookInfo().catch(() => null);
            if (wh?.ok && wh.result?.url) {
              console.log(`[POLLING] Webhook was configured (${wh.result.url}). Pausing poller.`);
              break;
            }
            console.warn(`[POLLING] Conflict (409) detected. Waiting 15s before retry...`);
            await new Promise((r) => setTimeout(r, 15000));
            continue;
          }

          if (res.status === 401 || res.status === 404) {
            console.error(`[POLLING] Telegram returned ${res.status}. Token may be invalid. Stopping poller.`);
            break;
          }

          // Back off on other errors
          const waitTime = Math.min(consecutiveErrors * 3000, 20000);
          console.warn(`[POLLING] getUpdates HTTP ${res.status}: ${text}. Retrying in ${waitTime / 1000}s...`);
          await new Promise((r) => setTimeout(r, waitTime));
          continue;
        }

        consecutiveErrors = 0;
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            if (update.update_id > lastUpdateId) {
              lastUpdateId = update.update_id;
            }

            console.log(`[POLLING] 📥 Received update #${update.update_id} from ${update.message?.from?.username || update.callback_query?.from?.username || 'user'}`);
            
            // Process update asynchronously without blocking the loop
            processTelegramUpdate(update).catch((err) => {
              console.error(`[POLLING] Error processing update #${update.update_id}:`, err);
            });
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || shouldStopPolling) {
          break;
        }
        consecutiveErrors++;
        const waitTime = Math.min(consecutiveErrors * 3000, 20000);
        console.warn(`[POLLING] Network or polling loop error: ${err.message}. Retrying in ${waitTime / 1000}s...`);
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    isPolling = false;
    console.log('[POLLING] Polling loop stopped.');
  })();
}

export function stopPolling(): void {
  shouldStopPolling = true;
  isPolling = false;
  if (pollAbortController) {
    try {
      pollAbortController.abort();
    } catch {}
    pollAbortController = null;
  }
}

export async function restartPolling(): Promise<void> {
  stopPolling();
  await new Promise((r) => setTimeout(r, 1000));
  lastUpdateId = 0;
  return startPolling();
}

export function getPollingStatus(): { isPolling: boolean; lastUpdateId: number } {
  return { isPolling, lastUpdateId };
}

