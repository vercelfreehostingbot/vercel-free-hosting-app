// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — VERCEL SERVERLESS WEBHOOK HANDLER
// =================================================================

import type { Request, Response } from 'express';
import { processTelegramUpdate } from '../../src/bot/index';
import { verifyWebhookSecret } from '../../src/lib/security';
import { TelegramUpdate } from '../../src/types';

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(200).json({
      status: 'online',
      message: 'Vercel Free Hosting Bot Webhook Endpoint',
    });
  }

  // Verify Telegram secret token header
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
  if (!verifyWebhookSecret(secretHeader)) {
    console.warn('[SECURITY] Unauthorized webhook request rejected.');
    return res.status(401).json({ error: 'Unauthorized secret token' });
  }

  const update: TelegramUpdate = req.body;
  if (!update || !update.update_id) {
    return res.status(400).json({ error: 'Invalid update payload' });
  }

  try {
    // Process update asynchronously in serverless environment
    await processTelegramUpdate(update);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Serverless Webhook Handler error:', error);
    return res.status(200).json({ ok: false, error: 'Internal processing error' });
  }
}
