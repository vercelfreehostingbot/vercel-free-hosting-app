// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — MAIN BOT UPDATE ROUTER
// =================================================================

import { TelegramUpdate } from '../types';
import { CONFIG } from '../lib/config';
import { getUserState, getUser, clearUserState, isAdmin } from '../lib/firebase';
import { sendMessage, answerCallbackQuery, editMessageText } from '../lib/telegram';
import { decodeCallbackData } from '../lib/callbackCache';
import { handleStartCommand, handleVerifyCallback, isUserCurrentlyJoined } from './handlers/start';
import {
  handleDeployPrompt,
  handleZipUpload,
  handleProjectNameInput,
  handleProjectZipUpdatePrompt,
  handleProjectZipUpdate,
} from './handlers/deploy';
import { handleMyProjects, handleProjectDetailsCallback } from './handlers/projects';
import { handleRedeployPrompt, handleRedeployCallback } from './handlers/redeploy';
import {
  handleAddDomainPrompt,
  handleDomainCallback,
  handleDomainInput,
} from './handlers/domain';
import {
  handleDeletePrompt,
  handleDeleteCallback,
  handleConfirmDelete,
} from './handlers/delete';
import {
  handleProjectFiles,
  handleFileView,
  handleFileEditPrompt,
  handleFileAddPrompt,
  handleFileAddNameInput,
  handleFileAddContentInput,
  handleFileDeleteConfirm,
  handleFileDeleteExecute,
  handleFolderAddPrompt,
  handleFolderAddNameInput,
  handleFolderDeleteConfirm,
  handleFolderDeleteExecute,
  handleFileEditContentInput,
  handleFileEditDocumentInput,
  handleFilePhotoUpload,
  handleFileVideoUpload,
  handleFileAudioUpload,
} from './handlers/files';
import {
  handleEnvList,
  handleEnvAddPrompt,
  handleEnvAddInput,
  handleEnvEditList,
  handleEnvEditItemPrompt,
  handleEnvEditInput,
  handleEnvDeleteList,
  handleEnvDeleteConfirm,
} from './handlers/env';
import { handleMyUsage, handleMyAccount, handleHelp } from './handlers/usage';
import {
  handleAdminCommand,
  handleAdminStats,
  handleAdminUsers,
  handleAdminUserView,
  handleAdminAllProjects,
  handleAdminSearchPrompt,
  handleAdminBanPrompt,
  handleAdminUnbanPrompt,
  handleAdminResetLimitPrompt,
  handleAdminDeleteProjectPrompt,
  handleAdminDeleteProjectConfirm,
  handleAdminDeleteProjectExecute,
  handleAdminBroadcastPrompt,
  handleAdminLogs,
  handleAdminAddPrompt,
  handleAdminRemovePrompt,
  handleAdminSettings,
  handleAdminSetWebhook,
  handleAdminDeleteWebhook,
  handleAdminQuickBan,
  handleAdminQuickUnban,
  handleAdminQuickReset,
  handleAdminStateInput,
} from './handlers/admin';
import { getMainMenuKeyboard, getAdminPanelKeyboard, getVerificationKeyboard } from './keyboards';

export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  try {
    // -------------------------------------------------------------
    // 0. IGNORE NON-MESSAGE / CHANNEL BROADCAST UPDATES
    // -------------------------------------------------------------
    if (
      (update as any).channel_post ||
      (update as any).edited_channel_post ||
      (update as any).edited_message ||
      (update as any).my_chat_member ||
      (update as any).chat_member ||
      (update as any).chat_join_request
    ) {
      return;
    }

    // -------------------------------------------------------------
    // 1. HANDLE INLINE CALLBACK QUERIES
    // -------------------------------------------------------------
    if (update.callback_query) {
      const cb = update.callback_query;
      const rawData = cb.data || '';
      const data = decodeCallbackData(rawData);

      // If callback originates from a group/channel, do not execute
      if (cb.message?.chat?.type && cb.message.chat.type !== 'private') {
        await answerCallbackQuery(cb.id, {
          text: 'This bot only operates in private direct chats.',
          show_alert: true,
        });
        return;
      }

      if (data === 'action:verify_membership') {
        await handleVerifyCallback(cb);
        return;
      }

      // Check if user is banned
      const user = await getUser(cb.from.id);
      if (user?.banned) {
        await answerCallbackQuery(cb.id, {
          text: '🚫 Your account has been suspended by the administrator.',
          show_alert: true,
        });
        return;
      }

      // Live Force Join Check for any callback action
      const isMember = await isUserCurrentlyJoined(cb.from.id);
      if (!isMember) {
        await answerCallbackQuery(cb.id, {
          text: '⚠️ You must join our official Channel & Group to use this bot!',
          show_alert: true,
        });
        await sendMessage(
          cb.message?.chat.id || cb.from.id,
          `🔐 *Verification Required / ফোর্স জয়েন আবশ্যক*\n\nYou have left our official Channel or Group. To continue using *${CONFIG.BOT_NAME}*, you MUST remain a member.\n\nPlease join both and verify again:`,
          {
            parse_mode: 'Markdown',
            reply_markup: getVerificationKeyboard(),
          }
        );
        return;
      }

      // --- ADMIN CALLBACK ROUTING ---
      if (data === 'admin:menu') {
        await answerCallbackQuery(cb.id);
        const text = `👑 *ADMIN CONTROL PANEL*\n\n👇 *Select an administrative task using the keyboard buttons below:*`;
        if (cb.message) {
          await editMessageText(cb.message.chat.id, cb.message.message_id, text, {
            parse_mode: 'Markdown',
          });
          await sendMessage(cb.message.chat.id, `🎛 *Admin Mode Active*\nChoose an action from your bottom keyboard:`, {
            parse_mode: 'Markdown',
            reply_markup: getAdminPanelKeyboard(),
          });
        }
        return;
      }

      if (data === 'admin:stats') {
        await handleAdminStats(cb);
        return;
      }

      if (data === 'admin:users') {
        await handleAdminUsers(cb, 0);
        return;
      }

      if (data.startsWith('admin:users_page:')) {
        const page = parseInt(data.replace('admin:users_page:', ''), 10) || 0;
        await handleAdminUsers(cb, page);
        return;
      }

      if (data.startsWith('admin:user_view:')) {
        const targetId = parseInt(data.replace('admin:user_view:', ''), 10);
        await handleAdminUserView(cb, targetId);
        return;
      }

      if (data.startsWith('admin:ban_now:')) {
        const targetId = parseInt(data.replace('admin:ban_now:', ''), 10);
        await handleAdminQuickBan(cb, targetId);
        return;
      }

      if (data.startsWith('admin:unban_now:')) {
        const targetId = parseInt(data.replace('admin:unban_now:', ''), 10);
        await handleAdminQuickUnban(cb, targetId);
        return;
      }

      if (data.startsWith('admin:reset_now:')) {
        const targetId = parseInt(data.replace('admin:reset_now:', ''), 10);
        await handleAdminQuickReset(cb, targetId);
        return;
      }

      if (data === 'admin:projects') {
        await handleAdminAllProjects(cb, 0);
        return;
      }

      if (data.startsWith('admin:projects_page:')) {
        const page = parseInt(data.replace('admin:projects_page:', ''), 10) || 0;
        await handleAdminAllProjects(cb, page);
        return;
      }

      if (data.startsWith('admin:del_proj_confirm:')) {
        const projId = data.replace('admin:del_proj_confirm:', '');
        await handleAdminDeleteProjectConfirm(cb, projId);
        return;
      }

      if (data.startsWith('admin:del_proj_execute:')) {
        const projId = data.replace('admin:del_proj_execute:', '');
        await handleAdminDeleteProjectExecute(cb, projId);
        return;
      }

      if (data === 'admin:search') {
        await handleAdminSearchPrompt(cb);
        return;
      }

      if (data === 'admin:ban') {
        await handleAdminBanPrompt(cb);
        return;
      }

      if (data === 'admin:unban') {
        await handleAdminUnbanPrompt(cb);
        return;
      }

      if (data === 'admin:reset_limit') {
        await handleAdminResetLimitPrompt(cb);
        return;
      }

      if (data === 'admin:delete_project') {
        await handleAdminDeleteProjectPrompt(cb);
        return;
      }

      if (data === 'admin:broadcast') {
        await handleAdminBroadcastPrompt(cb);
        return;
      }

      if (data === 'admin:logs') {
        await handleAdminLogs(cb);
        return;
      }

      if (data === 'admin:add_admin') {
        await handleAdminAddPrompt(cb);
        return;
      }

      if (data === 'admin:remove_admin') {
        await handleAdminRemovePrompt(cb);
        return;
      }

      if (data.startsWith('admin:remove_admin_now:')) {
        const targetId = parseInt(data.replace('admin:remove_admin_now:', ''), 10);
        await handleAdminStateInput({ from: cb.from, chat: { id: cb.from.id } } as any, 'WAITING_ADMIN_REMOVE', `${targetId}`);
        await handleAdminRemovePrompt(cb);
        return;
      }

      if (data === 'admin:settings') {
        await handleAdminSettings(cb);
        return;
      }

      if (data === 'admin:webhook_set_default') {
        await handleAdminSetWebhook(cb);
        return;
      }

      if (data === 'admin:webhook_delete') {
        await handleAdminDeleteWebhook(cb);
        return;
      }

      // --- PROJECT & USER CALLBACK ROUTING ---
      if (data.startsWith('proj:details:')) {
        const projectId = data.replace('proj:details:', '');
        await handleProjectDetailsCallback(cb, projectId);
        return;
      }

      if (data.startsWith('proj:files:')) {
        const rest = data.replace('proj:files:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const targetPath = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleProjectFiles(cb, projectId, targetPath);
        return;
      }

      if (data.startsWith('proj:file_view:')) {
        const rest = data.replace('proj:file_view:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const filePath = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFileView(cb, projectId, filePath);
        return;
      }

      if (data.startsWith('proj:file_edit:')) {
        const rest = data.replace('proj:file_edit:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const filePath = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFileEditPrompt(cb, projectId, filePath);
        return;
      }

      if (data.startsWith('proj:file_add_prompt:')) {
        const rest = data.replace('proj:file_add_prompt:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const targetDir = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFileAddPrompt(cb, projectId, targetDir);
        return;
      }

      if (data.startsWith('proj:folder_add_prompt:')) {
        const rest = data.replace('proj:folder_add_prompt:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const targetDir = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFolderAddPrompt(cb, projectId, targetDir);
        return;
      }

      if (data.startsWith('proj:folder_delete_confirm:')) {
        const rest = data.replace('proj:folder_delete_confirm:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const folderPath = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFolderDeleteConfirm(cb, projectId, folderPath);
        return;
      }

      if (data.startsWith('proj:folder_delete_exec:')) {
        const rest = data.replace('proj:folder_delete_exec:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const folderPath = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFolderDeleteExecute(cb, projectId, folderPath);
        return;
      }

      if (data.startsWith('proj:file_delete_confirm:')) {
        const rest = data.replace('proj:file_delete_confirm:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const filePath = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFileDeleteConfirm(cb, projectId, filePath);
        return;
      }

      if (data.startsWith('proj:file_delete_exec:')) {
        const rest = data.replace('proj:file_delete_exec:', '');
        const colonIdx = rest.indexOf(':');
        const projectId = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
        const filePath = colonIdx === -1 ? '' : rest.slice(colonIdx + 1);
        await handleFileDeleteExecute(cb, projectId, filePath);
        return;
      }

      if (data.startsWith('proj:env:')) {
        const projectId = data.replace('proj:env:', '');
        await handleEnvList(cb, projectId);
        return;
      }

      if (data.startsWith('proj:env_add:')) {
        const projectId = data.replace('proj:env_add:', '');
        await handleEnvAddPrompt(cb, projectId);
        return;
      }

      if (data.startsWith('proj:env_edit_list:')) {
        const projectId = data.replace('proj:env_edit_list:', '');
        await handleEnvEditList(cb, projectId);
        return;
      }

      if (data.startsWith('proj:env_edit_item:')) {
        const rest = data.replace('proj:env_edit_item:', '');
        const [projectId, envId] = rest.split(':');
        await handleEnvEditItemPrompt(cb, projectId, envId);
        return;
      }

      if (data.startsWith('proj:env_del_list:')) {
        const projectId = data.replace('proj:env_del_list:', '');
        await handleEnvDeleteList(cb, projectId);
        return;
      }

      if (data.startsWith('proj:env_del_confirm:')) {
        const rest = data.replace('proj:env_del_confirm:', '');
        const [projectId, envId] = rest.split(':');
        await handleEnvDeleteConfirm(cb, projectId, envId);
        return;
      }

      if (data.startsWith('proj:upload_zip:')) {
        const projectId = data.replace('proj:upload_zip:', '');
        await handleProjectZipUpdatePrompt(cb, projectId);
        return;
      }

      if (data.startsWith('proj:redeploy:')) {
        const projectId = data.replace('proj:redeploy:', '');
        await handleRedeployCallback(cb, projectId);
        return;
      }

      if (data.startsWith('proj:domain:')) {
        const projectId = data.replace('proj:domain:', '');
        await handleDomainCallback(cb, projectId);
        return;
      }

      if (data.startsWith('proj:delete:')) {
        const projectId = data.replace('proj:delete:', '');
        await handleDeleteCallback(cb, projectId);
        return;
      }

      if (data.startsWith('proj:confirm_delete:')) {
        const projectId = data.replace('proj:confirm_delete:', '');
        await handleConfirmDelete(cb, projectId);
        return;
      }

      if (data === 'action:cancel_admin') {
        await clearUserState(cb.from.id);
        await answerCallbackQuery(cb.id, { text: 'Admin action cancelled.' });
        if (cb.message) {
          await editMessageText(cb.message.chat.id, cb.message.message_id, `👑 *ADMIN CONTROL PANEL*\n\nAction cancelled. Select a task using the keyboard buttons below:`, {
            parse_mode: 'Markdown',
          });
          await sendMessage(cb.message.chat.id, `👇 *Use the bottom keyboard buttons:*`, {
            parse_mode: 'Markdown',
            reply_markup: getAdminPanelKeyboard(),
          });
        }
        return;
      }

      if (data === 'proj:cancel_delete' || data.startsWith('action:cancel')) {
        const userIsAdmin = await isAdmin(cb.from.id);
        await clearUserState(cb.from.id);
        await answerCallbackQuery(cb.id, { text: 'Action cancelled.' });
        if (cb.message) {
          await sendMessage(cb.message.chat.id, 'Action cancelled.', {
            reply_markup: getMainMenuKeyboard(userIsAdmin),
          });
        }
        return;
      }

      await answerCallbackQuery(cb.id);
      return;
    }

    // -------------------------------------------------------------
    // 2. HANDLE TELEGRAM MESSAGES
    // -------------------------------------------------------------
    if (update.message) {
      const msg = update.message;
      const from = msg.from;
      if (!from) return;

      // Strict private chat only
      if (msg.chat?.type && msg.chat.type !== 'private') {
        return;
      }

      const text = (msg.text || '').trim();

      // Check if user is banned
      const user = await getUser(from.id);
      if (user?.banned && !text.startsWith('/start')) {
        await sendMessage(
          msg.chat.id,
          `🚫 *ACCOUNT SUSPENDED*\n\nYour account has been suspended by the administrator.`
        );
        return;
      }

      // Command: /start
      if (text.startsWith('/start')) {
        await clearUserState(from.id);
        await handleStartCommand(msg);
        return;
      }

      // Live Force Join Check on ALL commands and interactions
      const isMember = await isUserCurrentlyJoined(from.id);
      if (!isMember) {
        await sendMessage(
          msg.chat.id,
          `🔐 *Verification Required / ফোর্স জয়েন আবশ্যক*\n\nYou have left our official Channel or Group. To continue using *${CONFIG.BOT_NAME}*, you MUST join both and remain a member.\n\nPlease join using the buttons below, then click *✅ Verify Membership*:`,
          {
            parse_mode: 'Markdown',
            reply_markup: getVerificationKeyboard(),
          }
        );
        return;
      }

      const userIsAdmin = await isAdmin(from.id);

      // Command: /admin or Admin Panel button
      if (text === '/admin' || text === '👑 Admin Panel') {
        await clearUserState(from.id);
        await handleAdminCommand(msg);
        return;
      }

      // Universal cancellation or Back to Main Menu
      if (
        text === '❌ Cancel' ||
        text.toLowerCase() === 'cancel' ||
        text === '/cancel' ||
        text === '⬅️ Back' ||
        text === '⬅️ Back to Main Menu'
      ) {
        await clearUserState(from.id);
        await sendMessage(msg.chat.id, 'Returned to Main Menu:', {
          reply_markup: getMainMenuKeyboard(userIsAdmin),
        });
        return;
      }

      // List of top-level navigation buttons
      const isNavMenuAction = [
        '🚀 Deploy Website',
        '📂 My Projects',
        '🌐 Add Domain',
        '🔄 Redeploy',
        '🗑 Delete Project',
        '📊 My Usage',
        '👤 My Account',
        'ℹ️ Help',
        '📊 Statistics',
        '👥 Users',
        '🌍 All Projects',
        '🔎 Search User',
        '🚫 Ban User',
        '✅ Unban User',
        '🔄 Reset Limit',
        '📢 Broadcast',
        '📜 System Logs',
        '➕ Add Admin',
        '❌ Remove Admin',
        '⚙️ Settings',
        '⬅️ Back to Main Menu',
      ].includes(text);

      // Check durable user workflow state
      const stateRecord = await getUserState(from.id);
      const state = stateRecord.state;

      if (isNavMenuAction) {
        // Clear any previous waiting state so menu commands always work immediately
        await clearUserState(from.id);
      } else {
        // Only if NOT a navigation button, check durable user workflow state for inputs
        if (state === 'WAITING_PROJECT_NAME' && text) {
          await handleProjectNameInput(msg, text);
          return;
        }

        if ((state === 'WAITING_FILE_ADD_SELECT' || state === 'WAITING_FILE_ADD_NAME') && text) {
          await handleFileAddNameInput(msg, text);
          return;
        }

        if (state === 'WAITING_FOLDER_NAME' && text) {
          await handleFolderAddNameInput(msg, text);
          return;
        }

        if (state === 'WAITING_FILE_ADD_CONTENT' && text) {
          await handleFileAddContentInput(msg, text);
          return;
        }

        if (state === 'WAITING_FILE_EDIT_CONTENT' && text) {
          await handleFileEditContentInput(msg, text);
          return;
        }

        if (state === 'WAITING_ENV_ADD_KEY_VALUE' && text) {
          await handleEnvAddInput(msg, text);
          return;
        }

        if (state === 'WAITING_ENV_EDIT_VALUE' && text) {
          await handleEnvEditInput(msg, text);
          return;
        }

        if (state === 'WAITING_DOMAIN' && text) {
          await handleDomainInput(msg, text);
          return;
        }

        if (state.startsWith('WAITING_ADMIN_') || state === 'WAITING_BROADCAST_MESSAGE') {
          if (text) {
            await handleAdminStateInput(msg, state, text);
            return;
          }
        }
      }

      // Check if user is in a file upload/edit/add state for media
      const isFileAddOrEditState =
        state === 'WAITING_FILE_EDIT_CONTENT' ||
        state === 'WAITING_FILE_ADD_SELECT' ||
        state === 'WAITING_FILE_ADD_NAME' ||
        state === 'WAITING_FOLDER_NAME' ||
        state === 'WAITING_FILE_ADD_CONTENT';

      // Handle Photo / Image Upload
      if (msg.photo && msg.photo.length > 0) {
        if (isFileAddOrEditState) {
          await handleFilePhotoUpload(msg);
          return;
        }
      }

      // Handle Video Upload
      if (msg.video) {
        if (isFileAddOrEditState) {
          await handleFileVideoUpload(msg);
          return;
        }
      }

      // Handle Audio Upload
      if (msg.audio) {
        if (isFileAddOrEditState) {
          await handleFileAudioUpload(msg);
          return;
        }
      }

      // Handle File/Document Upload
      if (msg.document) {
        if (isFileAddOrEditState) {
          await handleFileEditDocumentInput(msg);
          return;
        }

        if (state === 'WAITING_PROJECT_ZIP_UPDATE') {
          await handleProjectZipUpdate(msg);
          return;
        }

        await handleZipUpload(msg);
        return;
      }

      // Handle Main Menu & Admin Reply Keyboard Buttons
      switch (text) {
        case '🚀 Deploy Website':
          await handleDeployPrompt(msg);
          break;

        case '📂 My Projects':
          await handleMyProjects(msg);
          break;

        case '🌐 Add Domain':
          await handleAddDomainPrompt(msg);
          break;

        case '🔄 Redeploy':
          await handleRedeployPrompt(msg);
          break;

        case '🗑 Delete Project':
          if (userIsAdmin) {
            await handleAdminDeleteProjectPrompt(msg);
          } else {
            await handleDeletePrompt(msg);
          }
          break;

        case '📊 My Usage':
          await handleMyUsage(msg);
          break;

        case '👤 My Account':
          await handleMyAccount(msg);
          break;

        case 'ℹ️ Help':
          await handleHelp(msg);
          break;

        // Admin Menu Buttons
        case '📊 Statistics':
          await handleAdminStats(msg);
          break;

        case '👥 Users':
          await handleAdminUsers(msg, 0);
          break;

        case '🌍 All Projects':
          await handleAdminAllProjects(msg, 0);
          break;

        case '🔎 Search User':
          await handleAdminSearchPrompt(msg);
          break;

        case '🚫 Ban User':
          await handleAdminBanPrompt(msg);
          break;

        case '✅ Unban User':
          await handleAdminUnbanPrompt(msg);
          break;

        case '🔄 Reset Limit':
          await handleAdminResetLimitPrompt(msg);
          break;

        case '📢 Broadcast':
          await handleAdminBroadcastPrompt(msg);
          break;

        case '📜 System Logs':
          await handleAdminLogs(msg);
          break;

        case '➕ Add Admin':
          await handleAdminAddPrompt(msg);
          break;

        case '❌ Remove Admin':
          await handleAdminRemovePrompt(msg);
          break;

        case '⚙️ Settings':
          await handleAdminSettings(msg);
          break;

        case '⬅️ Back':
        case '⬅️ Back to Main Menu':
          await sendMessage(msg.chat.id, 'Returned to Main Menu:', {
            reply_markup: getMainMenuKeyboard(userIsAdmin),
          });
          break;

        default:
          if (state === 'WAITING_ZIP') {
            await sendMessage(
              msg.chat.id,
              `📦 Please upload your project as a *.zip* file attachment.`,
              { reply_markup: getMainMenuKeyboard(userIsAdmin) }
            );
          }
          break;
      }
    }
  } catch (error: any) {
    console.error('Telegram Update processing error:', error);
    if (update.message && update.message.chat?.type === 'private') {
      const userIsAdmin = update.message.from ? await isAdmin(update.message.from.id) : false;
      await sendMessage(
        update.message.chat.id,
        `❌ *Something went wrong.* Please try again later.`,
        { reply_markup: getMainMenuKeyboard(userIsAdmin) }
      );
    }
  }
}

