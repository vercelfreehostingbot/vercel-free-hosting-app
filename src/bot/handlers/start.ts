// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — START & VERIFICATION HANDLERS
// =================================================================

import { CONFIG } from '../../lib/config';
import { getOrCreateUser, setUserVerified, logSystemAction, getUser, isAdmin } from '../../lib/firebase';
import { sendMessage, checkChatMember, answerCallbackQuery } from '../../lib/telegram';
import { getVerificationKeyboard, getMainMenuKeyboard, getUserWelcomeInlineKeyboard } from '../keyboards';
import { TelegramMessage, TelegramCallbackQuery } from '../../types';

/**
 * Real-Time Active Force Join Verification Check
 * Checks live Telegram membership for both Channel and Group.
 * If user left the group/channel after verifying, this immediately detects it and revokes verification.
 */
export async function isUserCurrentlyJoined(userId: number): Promise<boolean> {
  // Super admin always bypasses membership check
  if (userId === CONFIG.SUPER_ADMIN_ID) {
    return true;
  }

  const channelTarget = CONFIG.CHANNEL_USERNAME
    ? `@${CONFIG.CHANNEL_USERNAME}`
    : CONFIG.CHANNEL_ID;
  const groupTarget = CONFIG.GROUP_USERNAME
    ? `@${CONFIG.GROUP_USERNAME}`
    : CONFIG.GROUP_ID;

  // If neither channel nor group is configured, pass check
  if (!channelTarget && !groupTarget) {
    return true;
  }

  try {
    const channelCheck = channelTarget
      ? await checkChatMember(channelTarget, userId)
      : { isMember: true };
    const groupCheck = groupTarget
      ? await checkChatMember(groupTarget, userId)
      : { isMember: true };

    const isMember = Boolean(channelCheck.isMember && groupCheck.isMember);

    // Synchronize durable verification status with real-time membership
    await setUserVerified(userId, isMember);

    return isMember;
  } catch (error) {
    console.error(`Force join check error for user ${userId}:`, error);
    return false;
  }
}

/**
 * Handles /start command
 */
export async function handleStartCommand(message: TelegramMessage) {
  const from = message.from;
  if (!from) return;

  // 1. Register or update user record in Firebase
  const user = await getOrCreateUser(from.id, {
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name,
  });

  // 2. Check if user is banned
  if (user.banned) {
    await sendMessage(
      message.chat.id,
      `🚫 *ACCOUNT SUSPENDED*\n\nYour account has been suspended by the administrator. You cannot use this bot.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 3. Strict Real-Time Force Join Membership Verification
  const isJoined = await isUserCurrentlyJoined(from.id);

  if (!isJoined) {
    const verificationText = `🔐 *Verification Required / ফোর্স জয়েন আবশ্যক*

To use *${CONFIG.BOT_NAME}*, you MUST join our official Channel and Group.

⚠️ *Rules:* You must remain in the channel and group to keep using the bot. If you leave at any time, access will be revoked automatically.

👉 Please join both using the buttons below, then click *✅ Verify Membership*:`;

    await sendMessage(message.chat.id, verificationText, {
      parse_mode: 'Markdown',
      reply_markup: getVerificationKeyboard(),
    });
    return;
  }

  // User is verified & currently a member
  await sendWelcomeSuccess(message.chat.id, from.first_name || 'User', from.id);
}

/**
 * Handles the inline "✅ Verify Membership" button click
 */
export async function handleVerifyCallback(callbackQuery: TelegramCallbackQuery) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  // Real-time live membership check
  const isJoined = await isUserCurrentlyJoined(from.id);

  if (isJoined) {
    await setUserVerified(from.id, true);
    await logSystemAction(from.id, 'USER_VERIFIED', 'SUCCESS');

    await answerCallbackQuery(callbackQuery.id, {
      text: '✅ Verification Successful! Welcome.',
      show_alert: false,
    });

    await sendWelcomeSuccess(chatId, from.first_name || 'User', from.id);
  } else {
    await answerCallbackQuery(callbackQuery.id, {
      text: '❌ Verification Failed! You must join both Channel & Group first.',
      show_alert: true,
    });

    const failedText = `❌ *Verification Failed / ভেরিফিকেশন ব্যর্থ*

You haven't joined our required Channel and Group yet.

1️⃣ Join the Official Channel
2️⃣ Join the Support Group
3️⃣ Click *✅ Verify Membership* again below.`;

    await sendMessage(chatId, failedText, {
      parse_mode: 'Markdown',
      reply_markup: getVerificationKeyboard(),
    });
  }
}

/**
 * Sends the main welcome message and displays Main Menu Reply Keyboard & Inline Links
 */
export async function sendWelcomeSuccess(
  chatId: number | string,
  firstName: string,
  userId?: number
) {
  const userIsAdmin = userId ? await isAdmin(userId) : false;

  const welcomeText = `👋 *Welcome, ${firstName}!*

Welcome to *${CONFIG.BOT_NAME}* 🚀
The fastest way to deploy and host your web projects on *Vercel* directly from Telegram!

✨ *Features & Limits:*
• ⚡️ *${CONFIG.DEFAULT_DAILY_LIMIT} Free Deployments Daily*
• 📦 *HTML, CSS, JS, React, Vite, Next.js & ZIP uploads*
• 🌐 *Instant HTTPS Live URL & Custom Domains*
• 🔄 *Instant Redeploy, File Editor & Env Manager*

━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 *Select an option from the menu below to get started:*`;

  // 1. Send inline keyboard with Channel, Group, and Developer/Owner contact
  await sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: getUserWelcomeInlineKeyboard(),
  });

  // 2. Ensure the full Reply Keyboard is set at the bottom
  await sendMessage(
    chatId,
    `📱 *Main Menu Ready* — Choose an action below:`,
    {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(userIsAdmin),
    }
  );
}

