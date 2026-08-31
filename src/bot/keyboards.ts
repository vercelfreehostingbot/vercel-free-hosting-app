// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — TELEGRAM KEYBOARDS
// =================================================================

import { CONFIG } from '../lib/config';
import { InlineKeyboardMarkup, ReplyKeyboardMarkup } from '../types';
import { createSafeButton } from '../lib/callbackCache';

/**
 * Resolves Official Channel Link
 */
export function getChannelUrl(): string {
  if (CONFIG.CHANNEL_USERNAME) {
    return `https://t.me/${CONFIG.CHANNEL_USERNAME.replace('@', '')}`;
  }
  if (CONFIG.CHANNEL_ID) {
    const cleanId = CONFIG.CHANNEL_ID.replace(/^-100/, '').replace(/^-/, '');
    return `https://t.me/c/${cleanId}`;
  }
  return 'https://t.me/kshakilrana658';
}

/**
 * Resolves Official Group Link
 */
export function getGroupUrl(): string {
  if (CONFIG.GROUP_USERNAME) {
    return `https://t.me/${CONFIG.GROUP_USERNAME.replace('@', '')}`;
  }
  if (CONFIG.GROUP_ID) {
    const cleanId = CONFIG.GROUP_ID.replace(/^-100/, '').replace(/^-/, '');
    return `https://t.me/c/${cleanId}`;
  }
  return 'https://t.me/kshakilrana658';
}

/**
 * Resolves Owner / Developer Contact Link
 */
export function getOwnerUrl(): string {
  return `tg://user?id=${CONFIG.SUPER_ADMIN_ID}`;
}

/**
 * User Welcome Inline Keyboard (Channel, Group, Owner)
 */
export function getUserWelcomeInlineKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📢 Official Channel', url: getChannelUrl() },
        { text: '👥 Support Group', url: getGroupUrl() },
      ],
      [
        { text: '👨‍💻 Developer / Owner', url: getOwnerUrl() },
      ],
    ],
  };
}

/**
 * Force Join Verification Inline Keyboard
 */
export function getVerificationKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📢 Join Channel', url: getChannelUrl() },
        { text: '👥 Join Group', url: getGroupUrl() },
      ],
      [
        { text: '👨‍💻 Developer / Owner', url: getOwnerUrl() },
      ],
      [
        createSafeButton('✅ Verify Membership', 'action:verify_membership'),
      ],
    ],
  };
}

/**
 * User Main Menu Reply Keyboard (Keyboard buttons at the bottom)
 */
export function getMainMenuKeyboard(showAdminButton = false): ReplyKeyboardMarkup {
  const keyboard: { text: string }[][] = [
    [{ text: '🚀 Deploy Website' }, { text: '📂 My Projects' }],
    [{ text: '🌐 Add Domain' }, { text: '🔄 Redeploy' }],
    [{ text: '🗑 Delete Project' }, { text: '📊 My Usage' }],
    [{ text: '👤 My Account' }, { text: 'ℹ️ Help' }],
  ];

  if (showAdminButton) {
    keyboard.push([{ text: '👑 Admin Panel' }]);
  }

  return {
    keyboard,
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * Admin Panel Reply Keyboard (Full Keyboard at the bottom)
 */
export function getAdminPanelKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: '📊 Statistics' }, { text: '👥 Users' }],
      [{ text: '🌍 All Projects' }, { text: '🔎 Search User' }],
      [{ text: '🚫 Ban User' }, { text: '✅ Unban User' }],
      [{ text: '🔄 Reset Limit' }, { text: '🗑 Delete Project' }],
      [{ text: '📢 Broadcast' }, { text: '📜 System Logs' }],
      [{ text: '➕ Add Admin' }, { text: '❌ Remove Admin' }],
      [{ text: '⚙️ Settings' }, { text: '⬅️ Back to Main Menu' }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * Admin Panel Inline Keyboard (Interactive dashboard)
 */
export function getAdminPanelInlineKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        createSafeButton('📊 Statistics', 'admin:stats'),
        createSafeButton('👥 Users', 'admin:users'),
      ],
      [
        createSafeButton('🌍 All Projects', 'admin:projects'),
        createSafeButton('🔎 Search User', 'admin:search'),
      ],
      [
        createSafeButton('🚫 Ban User', 'admin:ban'),
        createSafeButton('✅ Unban User', 'admin:unban'),
      ],
      [
        createSafeButton('🔄 Reset Limit', 'admin:reset_limit'),
        createSafeButton('🗑 Delete Project', 'admin:delete_project'),
      ],
      [
        createSafeButton('📢 Broadcast', 'admin:broadcast'),
        createSafeButton('📜 System Logs', 'admin:logs'),
      ],
      [
        createSafeButton('➕ Add Admin', 'admin:add_admin'),
        createSafeButton('❌ Remove Admin', 'admin:remove_admin'),
      ],
      [
        createSafeButton('⚙️ Settings', 'admin:settings'),
        createSafeButton('❌ Close', 'action:cancel_admin'),
      ],
    ],
  };
}

/**
 * Project Actions Inline Keyboard
 */
export function getProjectActionKeyboard(
  projectId: string,
  liveUrl?: string
): InlineKeyboardMarkup {
  let formattedUrl = (liveUrl || '').trim();
  if (formattedUrl && !formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = `https://${formattedUrl}`;
  }

  const rows: any[][] = [];
  if (formattedUrl && (formattedUrl.startsWith('http://') || formattedUrl.startsWith('https://'))) {
    rows.push([{ text: '🌐 Open Website', url: formattedUrl }]);
  }
  rows.push([
    createSafeButton('📁 Files / Edit Code', `proj:files:${projectId}`),
    createSafeButton('📦 Update via ZIP', `proj:upload_zip:${projectId}`),
  ]);
  rows.push([
    createSafeButton('⚙️ Env Variables', `proj:env:${projectId}`),
    createSafeButton('🔄 Redeploy', `proj:redeploy:${projectId}`),
  ]);
  rows.push([
    createSafeButton('📊 Details', `proj:details:${projectId}`),
    createSafeButton('🌐 Add Domain', `proj:domain:${projectId}`),
  ]);
  rows.push([
    createSafeButton('🗑 Delete Project', `proj:delete:${projectId}`),
  ]);

  return {
    inline_keyboard: rows,
  };
}

/**
 * Delete Confirmation Inline Keyboard
 */
export function getDeleteConfirmKeyboard(projectId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        createSafeButton('✅ Yes, Delete', `proj:confirm_delete:${projectId}`),
        createSafeButton('❌ Cancel', 'proj:cancel_delete'),
      ],
    ],
  };
}

/**
 * Cancel Inline Keyboard
 */
export function getCancelKeyboard(callbackData = 'action:cancel'): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[createSafeButton('❌ Cancel', callbackData)]],
  };
}

