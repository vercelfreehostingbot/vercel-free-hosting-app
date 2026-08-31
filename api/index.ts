import type { Request, Response } from 'express';
import express from 'express';
import { processTelegramUpdate } from '../src/bot/index';
import { verifyWebhookSecret } from '../src/lib/security';
import { getTelegramWebhookInfo, getTelegramMe, setTelegramWebhook } from '../src/lib/telegram';
import { getSystemStats } from '../src/lib/firebase';
import { CONFIG } from '../src/lib/config';
import { getWatchdogStatus } from '../src/lib/watchdog';
import { getPollingStatus } from '../src/bot/polling';

const app = express();

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Health Check
app.get(['/api/health', '/health', '/api', '/'], (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', platform: 'vercel', timestamp: Date.now() });
});

// Telegram Webhook Handler
const handleWebhook = async (req: Request, res: Response) => {
  try {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    if (!verifyWebhookSecret(secretHeader)) {
      return res.status(401).json({ error: 'Unauthorized secret token' });
    }

    const update = req.body;
    if (!update || (!update.update_id && !update.message && !update.callback_query)) {
      return res.status(400).json({ error: 'Invalid update payload' });
    }

    // Acknowledge Telegram immediately with 200 OK
    res.status(200).json({ ok: true });

    // Process update in background
    try {
      await processTelegramUpdate(update);
    } catch (procErr) {
      console.error('[VERCEL WEBHOOK] Error processing update:', procErr);
    }
  } catch (err: any) {
    console.error('[VERCEL WEBHOOK] Fatal error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};

const handleWebhookGet = (req: Request, res: Response) => {
  res.status(200).json({
    status: 'active',
    platform: 'vercel',
    ok: true,
    endpoint: req.originalUrl || req.path,
    bot_name: CONFIG.BOT_NAME,
    bot_username: `@${CONFIG.BOT_USERNAME}`,
    timestamp: Date.now(),
  });
};

app.post(['/api/telegram-webhook', '/telegram-webhook', '/api/telegram/webhook', '/telegram/webhook'], handleWebhook);
app.get(['/api/telegram-webhook', '/telegram-webhook', '/api/telegram/webhook', '/telegram/webhook'], handleWebhookGet);

// 1-Click Webhook Registration API for Vercel
app.post(['/api/set-webhook', '/set-webhook'], async (req: Request, res: Response) => {
  try {
    const host = req.headers.host || '';
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const appUrl = (CONFIG.APP_URL || `${protocol}://${host}`).replace(/\/$/, '');
    const webhookUrl = `${appUrl}/api/telegram-webhook`;

    const result = await setTelegramWebhook(webhookUrl);
    res.json({
      ok: result.ok,
      webhook_url: webhookUrl,
      description: result.description || (result.ok ? 'Webhook successfully activated on Telegram' : 'Failed to register webhook'),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// System Status API
app.get(['/api/status', '/status'], async (req: Request, res: Response) => {
  try {
    let stats: any = null;
    try {
      stats = await getSystemStats();
    } catch (statsErr) {
      console.warn('[VERCEL] Could not fetch stats:', statsErr);
    }

    let webhookInfo: any = null;
    let meInfo: any = null;
    try {
      [webhookInfo, meInfo] = await Promise.all([
        CONFIG.BOT_TOKEN ? getTelegramWebhookInfo() : null,
        CONFIG.BOT_TOKEN ? getTelegramMe() : null,
      ]);
    } catch (tgErr) {
      console.warn('[VERCEL] Could not fetch Telegram info:', tgErr);
    }

    const botUsername = meInfo?.result?.username ? `@${meInfo.result.username}` : `@${CONFIG.BOT_USERNAME}`;
    const botDisplayName = meInfo?.result?.first_name || CONFIG.BOT_NAME;

    res.json({
      status: 'ONLINE',
      platform: 'vercel',
      app_name: botDisplayName,
      bot_username: botUsername,
      super_admin_id: CONFIG.SUPER_ADMIN_ID,
      bot_info: meInfo?.result || null,
      stats,
      polling: getPollingStatus(),
      webhook: webhookInfo?.result || { status: 'unconfigured' },
      watchdog: getWatchdogStatus(),
      services: {
        telegram: Boolean(CONFIG.BOT_TOKEN),
        github: Boolean(CONFIG.GITHUB_TOKEN && CONFIG.GITHUB_USERNAME),
        vercel: Boolean(CONFIG.VERCEL_TOKEN),
        firebase: Boolean(CONFIG.FIREBASE_PROJECT_ID),
      },
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    res.status(500).json({ status: 'ERROR', error: error?.message });
  }
});

// Root /api handler
export default app;
