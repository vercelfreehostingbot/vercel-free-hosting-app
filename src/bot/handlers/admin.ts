// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — ADVANCED ADMIN CONTROL PANEL
// =================================================================

import { CONFIG, getTodayDateString } from '../../lib/config';
import {
  isAdmin,
  isSuperAdmin,
  getSystemStats,
  getAllUsers,
  getAllProjects,
  getUser,
  setUserBanStatus,
  resetUserDailyLimit,
  getUserProjects,
  deleteProjectRecord,
  addAdmin,
  removeAdmin,
  getAllAdmins,
  getRecentLogs,
  setUserState,
  clearUserState,
  logSystemAction,
} from '../../lib/firebase';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  deleteTelegramWebhook,
} from '../../lib/telegram';
import { deleteVercelProject } from '../../lib/vercelService';
import { deleteGitHubRepository } from '../../lib/github';
import { getAdminPanelKeyboard } from '../keyboards';
import { createSafeButton } from '../../lib/callbackCache';
import { startPolling, stopPolling } from '../polling';
import { ensureWebhookActive } from '../../lib/watchdog';
import { TelegramMessage, TelegramCallbackQuery, InlineKeyboardButton } from '../../types';

function extractChatInfo(item: TelegramMessage | TelegramCallbackQuery) {
  if ('data' in item || !('chat' in item)) {
    const cb = item as TelegramCallbackQuery;
    const from = cb.from;
    const chatId = cb.message?.chat?.id || from.id;
    return { isCb: true, from, chatId, cb, msg: cb.message };
  }
  const msg = item as TelegramMessage;
  const from = msg.from;
  const chatId = msg.chat.id;
  return { isCb: false, from, chatId, cb: undefined, msg };
}

/**
 * Handles /admin command or Admin Menu button
 */
export async function handleAdminCommand(message: TelegramMessage) {
  const from = message.from;
  if (!from) return;

  const adminAuth = await isAdmin(from.id);
  if (!adminAuth) {
    await sendMessage(
      message.chat.id,
      `🚫 *ACCESS DENIED*\n\nYou do not have administrative privileges.`
    );
    return;
  }

  const superAdminFlag = await isSuperAdmin(from.id);

  const text = `👑 *ADMIN CONTROL PANEL*

👤 *Admin:* ${from.first_name || 'Admin'}
🆔 *Your ID:* \`${from.id}\`
🛡 *Role:* ${superAdminFlag ? '🌟 Super Admin' : '🛡 Administrator'}
🤖 *Bot:* \`@${CONFIG.BOT_USERNAME}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 *Select an administrative task using the keyboard buttons below:*`;

  // Send message with both the Reply Keyboard for quick access and the Inline Dashboard
  await sendMessage(message.chat.id, text, {
    parse_mode: 'Markdown',
    reply_markup: getAdminPanelKeyboard(),
  });
}

/**
 * Handles Admin 📊 Statistics
 */
export async function handleAdminStats(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  const stats = await getSystemStats();

  const text = `📊 *SYSTEM STATISTICS & HEALTH*

👥 *Total Users:* ${stats.totalUsers}
🌐 *Total Projects:* ${stats.totalProjects}
🟢 *Active Projects:* ${stats.activeProjects}
🚀 *Today's Deployments:* ${stats.todayDeployments}
🚫 *Banned Users:* ${stats.bannedUsers}
💾 *Storage Engine:* ${stats.firebaseConnected ? '🟢 Firebase Firestore (Live)' : '🟡 In-Memory Storage'}
🤖 *Active Bot:* \`@${CONFIG.BOT_USERNAME}\`
⚡️ *Daily Quota per User:* ${CONFIG.DEFAULT_DAILY_LIMIT} deployments/day`;

  const keyboard: InlineKeyboardButton[][] = [
    [
      createSafeButton('👥 View Users', 'admin:users'),
      createSafeButton('🌍 View Projects', 'admin:projects'),
    ],
    [
      createSafeButton('🔄 Refresh Stats', 'admin:stats'),
      createSafeButton('🔙 Admin Menu', 'admin:menu'),
    ],
  ];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin 👥 Users list with 1-click tap-to-copy IDs & quick buttons
 */
export async function handleAdminUsers(
  messageOrCb: TelegramMessage | TelegramCallbackQuery,
  page = 0
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  const users = await getAllUsers();

  if (users.length === 0) {
    const emptyText = `👥 *REGISTERED USERS*\n\n_No users registered yet._`;
    const emptyKb = [[createSafeButton('🔙 Admin Menu', 'admin:menu')]];
    if (isCb && msg) {
      await editMessageText(chatId, msg.message_id, emptyText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: emptyKb },
      });
    } else {
      await sendMessage(chatId, emptyText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: emptyKb },
      });
    }
    return;
  }

  const PAGE_SIZE = 8;
  const totalPages = Math.ceil(users.length / PAGE_SIZE);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const pageUsers = users.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  let text = `👥 *REGISTERED USERS* (Page ${currentPage + 1}/${totalPages} — Total: ${users.length})\n\n`;
  text += `_💡 Note: Tap any \`User ID\` below to copy it instantly in 1 click!_\n\n`;

  const keyboard: InlineKeyboardButton[][] = [];

  pageUsers.forEach((u, i) => {
    const idx = currentPage * PAGE_SIZE + i + 1;
    const status = u.banned ? '🚫 BANNED' : '🟢 ACTIVE';
    const tag = u.username ? `@${u.username}` : u.first_name || 'User';
    text += `${idx}. ${status}\n   👤 ${tag}\n   🆔 \`${u.telegram_id}\`\n   📊 Builds today: ${u.daily_usage || 0}/${CONFIG.DEFAULT_DAILY_LIMIT}\n\n`;

    keyboard.push([
      createSafeButton(`👤 ${tag.slice(0, 12)} (\`${u.telegram_id}\`)`, `admin:user_view:${u.telegram_id}`),
      u.banned
        ? createSafeButton('✅ Unban', `admin:unban_now:${u.telegram_id}`)
        : createSafeButton('🚫 Ban', `admin:ban_now:${u.telegram_id}`),
    ]);
  });

  const navRow: InlineKeyboardButton[] = [];
  if (currentPage > 0) {
    navRow.push(createSafeButton('⬅️ Prev', `admin:users_page:${currentPage - 1}`));
  }
  if (currentPage < totalPages - 1) {
    navRow.push(createSafeButton('Next ➡️', `admin:users_page:${currentPage + 1}`));
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([
    createSafeButton('🔎 Search User ID', 'admin:search'),
    createSafeButton('🔙 Admin Menu', 'admin:menu'),
  ]);

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin Single User Inspector View
 */
export async function handleAdminUserView(
  callbackQuery: TelegramCallbackQuery,
  userId: number
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  if (!from || !(await isAdmin(from.id))) return;
  await answerCallbackQuery(callbackQuery.id);

  const user = await getUser(userId);
  if (!user) {
    await answerCallbackQuery(callbackQuery.id, { text: 'User not found.', show_alert: true });
    return;
  }

  const userProjects = await getUserProjects(userId);
  const today = getTodayDateString();
  const usage = user.daily_usage_date === today ? user.daily_usage || 0 : 0;

  const text = `👤 *USER MANAGEMENT PROFILE*

🆔 *Telegram ID:* (Tap to Copy)
\`${user.telegram_id}\`

👤 *Name:* ${user.first_name} ${user.last_name || ''}
${user.username ? `🌐 *Username:* @${user.username}\n` : ''}
📦 *Deployed Projects:* ${userProjects.length}
📊 *Today's Build Usage:* ${usage} / ${CONFIG.DEFAULT_DAILY_LIMIT}
🛡 *Account Status:* ${user.banned ? '🚫 Suspended / Banned' : '🟢 Active'}
📅 *Registered:* ${new Date(user.created_at).toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 *Quick Actions:*`;

  const keyboard: InlineKeyboardButton[][] = [
    [
      user.banned
        ? createSafeButton('✅ Unban User', `admin:unban_now:${userId}`)
        : createSafeButton('🚫 Ban User', `admin:ban_now:${userId}`),
      createSafeButton('🔄 Reset Quota to 0', `admin:reset_now:${userId}`),
    ],
    [
      createSafeButton('🔙 Back to Users', 'admin:users'),
      createSafeButton('👑 Admin Menu', 'admin:menu'),
    ],
  ];

  if (callbackQuery.message) {
    await editMessageText(chatId, callbackQuery.message.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin 🌍 All Projects list
 */
export async function handleAdminAllProjects(
  messageOrCb: TelegramMessage | TelegramCallbackQuery,
  page = 0
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  const projects = await getAllProjects();

  if (projects.length === 0) {
    const emptyText = `🌍 *ALL DEPLOYED PROJECTS*\n\n_No projects deployed yet._`;
    const emptyKb = [[createSafeButton('🔙 Admin Menu', 'admin:menu')]];
    if (isCb && msg) {
      await editMessageText(chatId, msg.message_id, emptyText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: emptyKb },
      });
    } else {
      await sendMessage(chatId, emptyText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: emptyKb },
      });
    }
    return;
  }

  const PAGE_SIZE = 6;
  const totalPages = Math.ceil(projects.length / PAGE_SIZE);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const pageProjects = projects.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  let text = `🌍 *ALL DEPLOYED PROJECTS* (Page ${currentPage + 1}/${totalPages} — Total: ${projects.length})\n\n`;

  const keyboard: InlineKeyboardButton[][] = [];

  pageProjects.forEach((p, i) => {
    const idx = currentPage * PAGE_SIZE + i + 1;
    text += `${idx}. *${p.project_name}*\n`;
    text += `   👤 Owner ID: \`${p.user_id}\`\n`;
    text += `   🔧 ${p.framework} | 🟢 ${p.status}\n`;
    text += `   🌐 ${p.vercel_url}\n\n`;

    keyboard.push([
      createSafeButton(`🔍 Details: ${p.project_name.slice(0, 16)}`, `proj:details:${p.project_id}`),
      createSafeButton(`🗑 Delete`, `admin:del_proj_confirm:${p.project_id}`),
    ]);
  });

  const navRow: InlineKeyboardButton[] = [];
  if (currentPage > 0) {
    navRow.push(createSafeButton('⬅️ Prev', `admin:projects_page:${currentPage - 1}`));
  }
  if (currentPage < totalPages - 1) {
    navRow.push(createSafeButton('Next ➡️', `admin:projects_page:${currentPage + 1}`));
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([createSafeButton('🔙 Admin Menu', 'admin:menu')]);

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin 🔎 Search User prompt
 */
export async function handleAdminSearchPrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  await setUserState(from.id, 'WAITING_ADMIN_SEARCH_USER');

  const text = `🔎 *SEARCH USER BY ID*

Please send the *Telegram User ID* (numbers only) to look up:

_Example: \`1234567890\`_`;

  const keyboard = [
    [createSafeButton('❌ Cancel', 'action:cancel_admin')],
  ];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin 🚫 Ban User prompt
 */
export async function handleAdminBanPrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  await setUserState(from.id, 'WAITING_ADMIN_BAN_USER');

  const text = `🚫 *BAN USER ACCOUNT*

Please send the *Telegram User ID* of the user to suspend:`;

  const keyboard = [[createSafeButton('❌ Cancel', 'action:cancel_admin')]];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin ✅ Unban User prompt
 */
export async function handleAdminUnbanPrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  await setUserState(from.id, 'WAITING_ADMIN_UNBAN_USER');

  const text = `✅ *UNBAN USER ACCOUNT*

Please send the *Telegram User ID* of the user to restore:`;

  const keyboard = [[createSafeButton('❌ Cancel', 'action:cancel_admin')]];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin 🔄 Reset Limit prompt
 */
export async function handleAdminResetLimitPrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  await setUserState(from.id, 'WAITING_ADMIN_RESET_LIMIT');

  const text = `🔄 *RESET DAILY DEPLOYMENT LIMIT*

Please send the *Telegram User ID* to reset their daily build counter back to 0:`;

  const keyboard = [[createSafeButton('❌ Cancel', 'action:cancel_admin')]];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin 🗑 Delete Project prompt
 */
export async function handleAdminDeleteProjectPrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, cb } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  // Directly show all projects for interactive deletion
  await handleAdminAllProjects(messageOrCb, 0);
}

/**
 * Handles Admin 📢 Broadcast prompt
 */
export async function handleAdminBroadcastPrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  await setUserState(from.id, 'WAITING_BROADCAST_MESSAGE');

  const text = `📢 *SYSTEM BROADCAST TO ALL USERS*

Please send the text message you wish to broadcast to all registered bot users:

_Markdown formatting is supported._`;

  const keyboard = [[createSafeButton('❌ Cancel', 'action:cancel_admin')]];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin 📜 System Logs
 */
export async function handleAdminLogs(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  const logs = await getRecentLogs(12);

  if (logs.length === 0) {
    const emptyText = `📜 *RECENT SYSTEM AUDIT LOGS*\n\n_No recent logs recorded._`;
    const emptyKb = [[createSafeButton('🔙 Admin Menu', 'admin:menu')]];
    if (isCb && msg) {
      await editMessageText(chatId, msg.message_id, emptyText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: emptyKb },
      });
    } else {
      await sendMessage(chatId, emptyText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: emptyKb },
      });
    }
    return;
  }

  let text = `📜 *RECENT SYSTEM AUDIT LOGS*\n\n`;
  logs.forEach((log) => {
    const time = new Date(log.timestamp).toLocaleTimeString();
    const statusIcon = log.status === 'SUCCESS' ? '✅' : log.status === 'FAILED' ? '❌' : 'ℹ️';
    text += `${statusIcon} *${log.action}* — \`${log.user_id}\` (${time})\n`;
    if (log.details) text += `   _${log.details}_\n`;
  });

  const keyboard = [
    [
      createSafeButton('🔄 Refresh Logs', 'admin:logs'),
      createSafeButton('🔙 Admin Menu', 'admin:menu'),
    ],
  ];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin ➕ Add Admin prompt
 */
export async function handleAdminAddPrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from) return;

  const superAdmin = await isSuperAdmin(from.id);
  if (!superAdmin) {
    const deny = `🚫 Only the Super Admin (\`${CONFIG.SUPER_ADMIN_ID}\`) can add new administrators.`;
    if (isCb && cb) await answerCallbackQuery(cb.id, { text: deny, show_alert: true });
    else await sendMessage(chatId, deny);
    return;
  }

  if (isCb && cb) await answerCallbackQuery(cb.id);

  await setUserState(from.id, 'WAITING_ADMIN_ADD');

  const text = `➕ *ADD NEW ADMINISTRATOR*

Please send the *Telegram User ID* (numbers only) to grant administrator rights:`;

  const keyboard = [[createSafeButton('❌ Cancel', 'action:cancel_admin')]];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin ❌ Remove Admin prompt
 */
export async function handleAdminRemovePrompt(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from) return;

  const superAdmin = await isSuperAdmin(from.id);
  if (!superAdmin) {
    const deny = `🚫 Only the Super Admin (\`${CONFIG.SUPER_ADMIN_ID}\`) can remove administrators.`;
    if (isCb && cb) await answerCallbackQuery(cb.id, { text: deny, show_alert: true });
    else await sendMessage(chatId, deny);
    return;
  }

  if (isCb && cb) await answerCallbackQuery(cb.id);

  const admins = await getAllAdmins();
  let text = `❌ *REMOVE ADMINISTRATOR*\n\nCurrent Admins:\n`;
  const keyboard: InlineKeyboardButton[][] = [];

  admins.forEach((a) => {
    text += `• \`${a.user_id}\` (${a.role})\n`;
    if (a.user_id !== CONFIG.SUPER_ADMIN_ID) {
      keyboard.push([
        createSafeButton(`❌ Remove \`${a.user_id}\``, `admin:remove_admin_now:${a.user_id}`),
      ]);
    }
  });

  text += `\n_Tap a button below or send the User ID to revoke privileges:_`;
  keyboard.push([createSafeButton('❌ Cancel', 'action:cancel_admin')]);

  await setUserState(from.id, 'WAITING_ADMIN_REMOVE');

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles Admin ⚙️ Settings view
 */
export async function handleAdminSettings(
  messageOrCb: TelegramMessage | TelegramCallbackQuery
) {
  const { isCb, from, chatId, cb, msg } = extractChatInfo(messageOrCb);

  if (!from || !(await isAdmin(from.id))) return;
  if (isCb && cb) await answerCallbackQuery(cb.id);

  let webhookInfoText = 'Checking...';
  try {
    const wh = await getTelegramWebhookInfo();
    if (wh?.ok && wh?.result?.url) {
      webhookInfoText = `🟢 Active (\`${wh.result.url}\`)\n• *Pending Updates:* ${wh.result.pending_update_count || 0}`;
    } else {
      webhookInfoText = `🟡 Not Registered / Long Polling Active`;
    }
  } catch {
    webhookInfoText = 'Polling Active';
  }

  const webhookEndpoint = `${CONFIG.APP_URL}/api/telegram-webhook`;

  const text = `⚙️ *SYSTEM CONFIGURATION & WEBHOOK*

• *Bot Name:* ${CONFIG.BOT_NAME}
• *Bot Username:* \`@${CONFIG.BOT_USERNAME}\`
• *Super Admin ID:* \`${CONFIG.SUPER_ADMIN_ID}\`
• *App Base URL:* \`${CONFIG.APP_URL}\`
• *Webhook Status:* ${webhookInfoText}
• *Target Webhook:* \`${webhookEndpoint}\`
• *24/7 Watchdog:* 🛡️ \`Active (Permanent Self-Healing)\`
• *Daily Limit:* ${CONFIG.DEFAULT_DAILY_LIMIT} deployments/day
• *Max ZIP Size:* ${CONFIG.MAX_ZIP_SIZE_MB}MB
• *Force Join Channel:* \`${CONFIG.CHANNEL_ID || 'Not configured'}\`
• *Force Join Group:* \`${CONFIG.GROUP_ID || 'Not configured'}\`
• *GitHub Username:* \`${CONFIG.GITHUB_USERNAME || 'Not configured'}\`
• *Vercel Integration:* ${CONFIG.VERCEL_TOKEN ? '✅ Active' : '❌ Missing Token'}`;

  const keyboard: InlineKeyboardButton[][] = [
    [
      createSafeButton('🛡️ Sync & Lock 24/7 Webhook', 'admin:webhook_set_default'),
      createSafeButton('🔄 Refresh Status', 'admin:settings'),
    ],
    [
      createSafeButton('🔙 Admin Menu', 'admin:menu'),
    ],
  ];

  if (isCb && msg) {
    await editMessageText(chatId, msg.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Sets Telegram Webhook to https://free-hosting-bot.ai.studio/api/telegram-webhook and confirms Watchdog lock
 */
export async function handleAdminSetWebhook(
  callbackQuery: TelegramCallbackQuery,
  customUrl?: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  if (!from || !(await isAdmin(from.id))) return;
  await answerCallbackQuery(callbackQuery.id, { text: 'Syncing 24/7 Webhook...' });

  const targetUrl = (customUrl || `${CONFIG.APP_URL}/api/telegram-webhook`).trim();

  try {
    const success = await ensureWebhookActive();
    await logSystemAction(from.id, 'WEBHOOK_SET', success ? 'SUCCESS' : 'FAILED', undefined, targetUrl);

    const resText = success
      ? `✅ *24/7 WEBHOOK LOCKED & VERIFIED!*\n\n🌐 *Webhook URL:* \`${targetUrl}\`\n🛡️ *Watchdog:* Permanent auto-recovery active.\n🤖 *Status:* Instant updates guaranteed 24/7.`
      : `⚠️ *Webhook check completed.*\n\nEndpoint: \`${targetUrl}\`\nFailover poller standby ready.`;

    const keyboard = [
      [
        createSafeButton('⚙️ Back to Settings', 'admin:settings'),
        createSafeButton('🔙 Admin Menu', 'admin:menu'),
      ],
    ];

    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, resText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await sendMessage(chatId, resText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error: any) {
    await sendMessage(chatId, `❌ Error syncing webhook: ${error?.message || error}`);
  }
}

/**
 * Deletes Telegram Webhook (switches to polling)
 */
export async function handleAdminDeleteWebhook(callbackQuery: TelegramCallbackQuery) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  if (!from || !(await isAdmin(from.id))) return;
  await answerCallbackQuery(callbackQuery.id, { text: 'Deleting Telegram Webhook...' });

  try {
    const result = await deleteTelegramWebhook();
    if (result.ok) {
      startPolling().catch((err) => console.error('[POLLING] Error starting poller after webhook deletion:', err));
    }
    await logSystemAction(from.id, 'WEBHOOK_DELETED', result.ok ? 'SUCCESS' : 'FAILED');

    const resText = result.ok
      ? `🗑 *WEBHOOK DELETED!*\n\n🤖 The bot is now running in automatic Long Polling mode.`
      : `❌ *Failed to delete webhook:*\n\n${result.description || 'Unknown error'}`;

    const keyboard = [
      [
        createSafeButton('⚙️ Back to Settings', 'admin:settings'),
        createSafeButton('🔙 Admin Menu', 'admin:menu'),
      ],
    ];

    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, resText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await sendMessage(chatId, resText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error: any) {
    await sendMessage(chatId, `❌ Error deleting webhook: ${error?.message || error}`);
  }
}

/**
 * Handles instant 1-Click Ban Action from Inline Button
 */
export async function handleAdminQuickBan(
  callbackQuery: TelegramCallbackQuery,
  userId: number
) {
  const from = callbackQuery.from;
  if (!from || !(await isAdmin(from.id))) return;

  if (userId === CONFIG.SUPER_ADMIN_ID) {
    await answerCallbackQuery(callbackQuery.id, {
      text: 'Cannot ban the Super Admin.',
      show_alert: true,
    });
    return;
  }

  await setUserBanStatus(userId, true);
  await logSystemAction(from.id, 'USER_BANNED', 'SUCCESS', undefined, `Banned user ${userId}`);
  await answerCallbackQuery(callbackQuery.id, { text: `User ${userId} has been banned.` });
  await handleAdminUserView(callbackQuery, userId);
}

/**
 * Handles instant 1-Click Unban Action from Inline Button
 */
export async function handleAdminQuickUnban(
  callbackQuery: TelegramCallbackQuery,
  userId: number
) {
  const from = callbackQuery.from;
  if (!from || !(await isAdmin(from.id))) return;

  await setUserBanStatus(userId, false);
  await logSystemAction(from.id, 'USER_UNBANNED', 'SUCCESS', undefined, `Unbanned user ${userId}`);
  await answerCallbackQuery(callbackQuery.id, { text: `User ${userId} has been unbanned.` });
  await handleAdminUserView(callbackQuery, userId);
}

/**
 * Handles instant 1-Click Reset Quota Action from Inline Button
 */
export async function handleAdminQuickReset(
  callbackQuery: TelegramCallbackQuery,
  userId: number
) {
  const from = callbackQuery.from;
  if (!from || !(await isAdmin(from.id))) return;

  await resetUserDailyLimit(userId);
  await logSystemAction(from.id, 'LIMIT_RESET', 'SUCCESS', undefined, `Reset limit for ${userId}`);
  await answerCallbackQuery(callbackQuery.id, {
    text: `Daily build limit for User ${userId} reset to 0.`,
    show_alert: true,
  });
  await handleAdminUserView(callbackQuery, userId);
}

/**
 * Handles Admin Project Deletion Confirmation Dialog
 */
export async function handleAdminDeleteProjectConfirm(
  callbackQuery: TelegramCallbackQuery,
  projectId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  if (!from || !(await isAdmin(from.id))) return;
  await answerCallbackQuery(callbackQuery.id);

  const text = `⚠️ *ADMIN CONFIRM PROJECT DELETION*

Are you sure you want to permanently delete project \`${projectId}\`?
This will:
• Delete Vercel deployment and project
• Delete GitHub repository
• Purge Firestore record`;

  const keyboard = [
    [
      createSafeButton('🔥 Yes, Permanently Delete', `admin:del_proj_execute:${projectId}`),
      createSafeButton('❌ Cancel', 'admin:projects'),
    ],
  ];

  if (callbackQuery.message) {
    await editMessageText(chatId, callbackQuery.message.message_id, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Executes Admin Project Deletion
 */
export async function handleAdminDeleteProjectExecute(
  callbackQuery: TelegramCallbackQuery,
  projectId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  if (!from || !(await isAdmin(from.id))) return;
  await answerCallbackQuery(callbackQuery.id, { text: 'Deleting project...' });

  const allProjects = await getAllProjects();
  const project = allProjects.find((p) => p.project_id === projectId);

  if (!project) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Project not found.', show_alert: true });
    return;
  }

  try {
    if (project.vercel_project) {
      await deleteVercelProject(project.vercel_project).catch((e) =>
        console.warn('Vercel delete warning:', e)
      );
    }
    if (project.github_repository) {
      await deleteGitHubRepository(project.github_repository).catch((e) =>
        console.warn('GitHub delete warning:', e)
      );
    }
    await deleteProjectRecord(projectId);
    await logSystemAction(from.id, 'ADMIN_PROJECT_DELETED', 'SUCCESS', projectId, `Deleted project ${project.project_name}`);

    const successText = `✅ *Project \`${project.project_name}\` was permanently deleted by Admin.*`;
    const keyboard = [[createSafeButton('🌍 Back to All Projects', 'admin:projects')]];

    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, successText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await sendMessage(chatId, successText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (err: any) {
    console.error('Admin project delete error:', err);
    await answerCallbackQuery(callbackQuery.id, {
      text: `Failed: ${err?.message || 'Error'}`,
      show_alert: true,
    });
  }
}

/**
 * Process text inputs for waiting Admin actions
 */
export async function handleAdminStateInput(
  message: TelegramMessage,
  stateType: string,
  text: string
) {
  const from = message.from;
  if (!from || !(await isAdmin(from.id))) return;

  const inputTrimmed = text.trim();

  // Search User
  if (stateType === 'WAITING_ADMIN_SEARCH_USER') {
    await clearUserState(from.id);
    const targetId = parseInt(inputTrimmed, 10);
    if (isNaN(targetId)) {
      await sendMessage(message.chat.id, `❌ Invalid Telegram ID. Please enter numbers only.`);
      return;
    }

    const user = await getUser(targetId);
    if (!user) {
      await sendMessage(message.chat.id, `❌ User \`${targetId}\` not found in database.`);
      return;
    }

    const userProjects = await getUserProjects(targetId);
    const today = getTodayDateString();
    const usage = user.daily_usage_date === today ? user.daily_usage || 0 : 0;

    const userCard = `👤 *USER SEARCH RESULT*

🆔 *ID:* (Tap to Copy)
\`${user.telegram_id}\`

👤 *Name:* ${user.first_name} ${user.last_name || ''}
${user.username ? `🌐 *Username:* @${user.username}\n` : ''}
📦 *Projects:* ${userProjects.length}
📊 *Today's Usage:* ${usage} / ${CONFIG.DEFAULT_DAILY_LIMIT}
🛡 *Status:* ${user.banned ? '🚫 Banned' : '🟢 Active'}
📅 *Joined:* ${new Date(user.created_at).toLocaleString()}`;

    const keyboard: InlineKeyboardButton[][] = [
      [
        user.banned
          ? createSafeButton('✅ Unban User', `admin:unban_now:${user.telegram_id}`)
          : createSafeButton('🚫 Ban User', `admin:ban_now:${user.telegram_id}`),
        createSafeButton('🔄 Reset Quota', `admin:reset_now:${user.telegram_id}`),
      ],
      [createSafeButton('🔙 Admin Menu', 'admin:menu')],
    ];

    await sendMessage(message.chat.id, userCard, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  // Ban User
  if (stateType === 'WAITING_ADMIN_BAN_USER') {
    await clearUserState(from.id);
    const targetId = parseInt(inputTrimmed, 10);
    if (isNaN(targetId)) {
      await sendMessage(message.chat.id, `❌ Invalid Telegram ID.`);
      return;
    }

    if (targetId === CONFIG.SUPER_ADMIN_ID) {
      await sendMessage(message.chat.id, `🚫 You cannot ban the Super Admin.`);
      return;
    }

    await setUserBanStatus(targetId, true);
    await logSystemAction(from.id, 'USER_BANNED', 'SUCCESS', undefined, `Banned user ${targetId}`);
    await sendMessage(message.chat.id, `🚫 *User \`${targetId}\` has been banned.*`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [createSafeButton('✅ Unban User', `admin:unban_now:${targetId}`)],
          [createSafeButton('🔙 Admin Menu', 'admin:menu')],
        ],
      },
    });
    return;
  }

  // Unban User
  if (stateType === 'WAITING_ADMIN_UNBAN_USER') {
    await clearUserState(from.id);
    const targetId = parseInt(inputTrimmed, 10);
    if (isNaN(targetId)) {
      await sendMessage(message.chat.id, `❌ Invalid Telegram ID.`);
      return;
    }

    await setUserBanStatus(targetId, false);
    await logSystemAction(from.id, 'USER_UNBANNED', 'SUCCESS', undefined, `Unbanned user ${targetId}`);
    await sendMessage(message.chat.id, `✅ *User \`${targetId}\` has been unbanned.*`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [createSafeButton('🚫 Ban User', `admin:ban_now:${targetId}`)],
          [createSafeButton('🔙 Admin Menu', 'admin:menu')],
        ],
      },
    });
    return;
  }

  // Reset Limit
  if (stateType === 'WAITING_ADMIN_RESET_LIMIT') {
    await clearUserState(from.id);
    const targetId = parseInt(inputTrimmed, 10);
    if (isNaN(targetId)) {
      await sendMessage(message.chat.id, `❌ Invalid Telegram ID.`);
      return;
    }

    await resetUserDailyLimit(targetId);
    await logSystemAction(from.id, 'LIMIT_RESET', 'SUCCESS', undefined, `Reset daily limit for ${targetId}`);
    await sendMessage(
      message.chat.id,
      `🔄 *Daily build limit for User \`${targetId}\` has been reset to 0.*`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[createSafeButton('🔙 Admin Menu', 'admin:menu')]] },
      }
    );
    return;
  }

  // Add Admin
  if (stateType === 'WAITING_ADMIN_ADD') {
    await clearUserState(from.id);
    const targetId = parseInt(inputTrimmed, 10);
    if (isNaN(targetId)) {
      await sendMessage(message.chat.id, `❌ Invalid Telegram ID.`);
      return;
    }

    await addAdmin(targetId, from.id);
    await logSystemAction(from.id, 'ADMIN_ADDED', 'SUCCESS', undefined, `Added admin ${targetId}`);
    await sendMessage(
      message.chat.id,
      `➕ *User \`${targetId}\` is now an authorized Administrator.*`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[createSafeButton('🔙 Admin Menu', 'admin:menu')]] },
      }
    );
    return;
  }

  // Remove Admin
  if (stateType === 'WAITING_ADMIN_REMOVE') {
    await clearUserState(from.id);
    const targetId = parseInt(inputTrimmed, 10);
    if (isNaN(targetId)) {
      await sendMessage(message.chat.id, `❌ Invalid Telegram ID.`);
      return;
    }

    if (targetId === CONFIG.SUPER_ADMIN_ID) {
      await sendMessage(message.chat.id, `🚫 Super Admin cannot be removed.`);
      return;
    }

    await removeAdmin(targetId);
    await logSystemAction(from.id, 'ADMIN_REMOVED', 'SUCCESS', undefined, `Removed admin ${targetId}`);
    await sendMessage(
      message.chat.id,
      `❌ *Admin privileges revoked for User \`${targetId}\`.*`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[createSafeButton('🔙 Admin Menu', 'admin:menu')]] },
      }
    );
    return;
  }

  // Broadcast
  if (stateType === 'WAITING_BROADCAST_MESSAGE') {
    await clearUserState(from.id);
    const broadcastText = `📢 *ANNOUNCEMENT*\n\n${text}\n\n— *${CONFIG.BOT_NAME} Team*`;

    const statusMsg = await sendMessage(
      message.chat.id,
      `⏳ *Broadcasting message to registered users...*`
    );
    const statusMsgId = statusMsg.result?.message_id;

    const users = await getAllUsers();
    let sent = 0;
    let failed = 0;

    for (const u of users) {
      try {
        const res = await sendMessage(u.telegram_id, broadcastText, { parse_mode: 'Markdown' });
        if (res.ok) {
          sent++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    const summary = `📢 *BROADCAST COMPLETE*

• *Total Users:* ${users.length}
• *Sent Successfully:* ${sent}
• *Failed:* ${failed}`;

    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, summary, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[createSafeButton('🔙 Admin Menu', 'admin:menu')]] },
      });
    } else {
      await sendMessage(message.chat.id, summary, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[createSafeButton('🔙 Admin Menu', 'admin:menu')]] },
      });
    }

    await logSystemAction(
      from.id,
      'BROADCAST',
      'SUCCESS',
      undefined,
      `Broadcast sent to ${sent} users`
    );
    return;
  }
}
