// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — VERCEL ENVIRONMENT VARIABLES HANDLER
// =================================================================

import { getProject, getUserState, clearUserState, setUserState, logSystemAction } from '../../lib/firebase';
import { sendMessage, editMessageText, answerCallbackQuery } from '../../lib/telegram';
import {
  getVercelEnvVariables,
  addVercelEnvVariable,
  editVercelEnvVariable,
  deleteVercelEnvVariable,
  maskSecretValue,
  VercelEnvVar,
} from '../../lib/vercel';
import { createSafeButton } from '../../lib/callbackCache';
import { TelegramCallbackQuery, TelegramMessage, InlineKeyboardButton } from '../../types';

/**
 * Handles "⚙️ Env Variables" callback — Displays list of Vercel env variables with masked secrets
 */
export async function handleEnvList(
  callbackQuery: TelegramCallbackQuery,
  projectId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Project not found.', show_alert: true });
    return;
  }

  if (project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, {
      text: 'Access Denied: You do not own this project.',
      show_alert: true,
    });
    return;
  }

  await answerCallbackQuery(callbackQuery.id, { text: 'Loading Vercel Environment Variables...' });

  try {
    const envs = await getVercelEnvVariables(project.vercel_project);

    let text = `⚙️ *VERCEL ENVIRONMENT VARIABLES*\n\n`;
    text += `📦 *Project:* \`${project.project_name}\`\n`;
    text += `▲ *Vercel:* \`${project.vercel_project}\`\n`;
    text += `🔒 *Storage:* Direct Vercel Project (Excluded from GitHub)\n\n`;

    if (envs.length === 0) {
      text += `_No environment variables configured yet._\n\nClick *➕ Add Variable* below to define API keys, secrets, or configuration values.`;
    } else {
      text += `*Configured Variables (${envs.length}):*\n\n`;
      envs.forEach((env, idx) => {
        const masked = maskSecretValue(env.key, env.value);
        text += `${idx + 1}. \`${env.key}\` = \`${masked}\`\n`;
      });
      text += `\n_Secrets are automatically masked for privacy._`;
    }

    const keyboard: InlineKeyboardButton[][] = [];

    // Add Variable
    keyboard.push([
      createSafeButton('➕ Add Variable', `proj:env_add:${projectId}`),
    ]);

    // Edit and Delete buttons if envs exist
    if (envs.length > 0) {
      keyboard.push([
        createSafeButton('✏️ Edit Variable', `proj:env_edit_list:${projectId}`),
        createSafeButton('🗑 Delete Variable', `proj:env_del_list:${projectId}`),
      ]);
    }

    keyboard.push([
      createSafeButton('🔄 Redeploy Project', `proj:redeploy:${projectId}`),
      createSafeButton('🔙 Back to Project', `proj:details:${projectId}`),
    ]);

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
  } catch (error: any) {
    console.error('Error fetching Vercel envs:', error);
    const errText = `❌ *Failed to fetch Environment Variables*\n\n${error?.message || 'Could not load Vercel project configuration.'}`;
    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, errText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[createSafeButton('🔙 Back to Project', `proj:details:${projectId}`)]],
        },
      });
    }
  }
}

/**
 * Prompts user to send KEY=VALUE for adding a new environment variable
 */
export async function handleEnvAddPrompt(
  callbackQuery: TelegramCallbackQuery,
  projectId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Project not found.', show_alert: true });
    return;
  }

  if (project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, {
      text: 'Access Denied: You do not own this project.',
      show_alert: true,
    });
    return;
  }

  await answerCallbackQuery(callbackQuery.id);

  // Set user state
  await setUserState(from.id, 'WAITING_ENV_ADD_KEY_VALUE', {
    project_id: projectId,
    vercel_project: project.vercel_project,
  });

  const promptText = `➕ *ADD ENVIRONMENT VARIABLE*

📦 *Project:* \`${project.project_name}\`
▲ *Target:* Vercel Production & Preview

━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Send your variable in the following format:*

\`KEY=VALUE\`

*Examples:*
\`GMAIL_USER=myemail@gmail.com\`
\`GMAIL_APP_PASSWORD=abcd1234efgh5678\`
\`DATABASE_URL=postgres://user:pass@host/db\`
\`CUSTOM_AI_API_URL=https://api.example.com\`

_You can also send multiple variables at once (one per line)._`;

  const keyboard = [
    [createSafeButton('❌ Cancel', `proj:env:${projectId}`)],
  ];

  if (callbackQuery.message) {
    await editMessageText(chatId, callbackQuery.message.message_id, promptText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(chatId, promptText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles incoming KEY=VALUE message from user and adds to Vercel
 */
export async function handleEnvAddInput(message: TelegramMessage, rawInput: string) {
  const from = message.from;
  if (!from) return;

  const stateRecord = await getUserState(from.id);
  const tempData = stateRecord.temp_data || {};
  const projectId = tempData.project_id;
  const vercelProject = tempData.vercel_project;

  if (!projectId || !vercelProject) {
    await clearUserState(from.id);
    await sendMessage(
      message.chat.id,
      `⚠️ *Session Expired*\n\nPlease select the project again from *📂 My Projects*.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await clearUserState(from.id);
    await sendMessage(message.chat.id, `❌ Access denied or project not found.`);
    return;
  }

  // Parse lines: each line can be KEY=VALUE or KEY = VALUE
  const lines = rawInput.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const pairs: Array<{ key: string; value: string }> = [];

  for (const line of lines) {
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Remove wrapping quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      pairs.push({ key, value });
    }
  }

  if (pairs.length === 0) {
    await sendMessage(
      message.chat.id,
      `❌ *Invalid Format*\n\nPlease provide variables in \`KEY=VALUE\` format.\n\nExample: \`API_KEY=my_secret_token\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[createSafeButton('❌ Cancel', `proj:env:${projectId}`)]],
        },
      }
    );
    return;
  }

  const statusMsg = await sendMessage(
    message.chat.id,
    `⏳ *Saving ${pairs.length} Environment Variable(s) to Vercel...*`,
    { parse_mode: 'Markdown' }
  );
  const statusMsgId = statusMsg.result?.message_id;

  const addedKeys: string[] = [];
  const errors: string[] = [];

  for (const pair of pairs) {
    try {
      await addVercelEnvVariable(vercelProject, pair.key, pair.value);
      addedKeys.push(pair.key);
    } catch (err: any) {
      console.warn(`Error adding env ${pair.key}:`, err);
      errors.push(`${pair.key}: ${err?.message || 'Failed'}`);
    }
  }

  await clearUserState(from.id);

  if (addedKeys.length > 0) {
    await logSystemAction(from.id, 'ENV_ADDED', 'SUCCESS', projectId, `Added ${addedKeys.join(', ')}`);
  }

  let resultText = `⚙️ *ENVIRONMENT VARIABLES UPDATED!*

📦 *Project:* \`${project.project_name}\`
▲ *Vercel Project:* \`${vercelProject}\`

`;

  if (addedKeys.length > 0) {
    resultText += `✅ *Successfully Added (${addedKeys.length}):*\n`;
    addedKeys.forEach((k) => {
      resultText += `• \`${k}\`\n`;
    });
    resultText += `\n_🔒 Stored securely in Vercel. Not committed to GitHub._\n\n`;
    resultText += `💡 *Important:* Trigger a *🚀 Redeploy* for the new variables to take effect on your running website.`;
  }

  if (errors.length > 0) {
    resultText += `\n\n⚠️ *Errors encountered:*\n`;
    errors.forEach((e) => {
      resultText += `• ${e}\n`;
    });
  }

  const keyboard = [
    [createSafeButton('🚀 Redeploy Website', `proj:redeploy:${projectId}`)],
    [
      createSafeButton('➕ Add Another', `proj:env_add:${projectId}`),
      createSafeButton('⚙️ View All Variables', `proj:env:${projectId}`),
    ],
    [createSafeButton('📦 Project Details', `proj:details:${projectId}`)],
  ];

  if (statusMsgId) {
    await editMessageText(message.chat.id, statusMsgId, resultText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    await sendMessage(message.chat.id, resultText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
}

/**
 * Handles "✏️ Edit Variable" — Lists variables to pick which to edit
 */
export async function handleEnvEditList(
  callbackQuery: TelegramCallbackQuery,
  projectId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Access denied or project not found.', show_alert: true });
    return;
  }

  await answerCallbackQuery(callbackQuery.id);

  try {
    const envs = await getVercelEnvVariables(project.vercel_project);
    if (envs.length === 0) {
      await answerCallbackQuery(callbackQuery.id, { text: 'No variables to edit.', show_alert: true });
      return;
    }

    const text = `✏️ *SELECT VARIABLE TO EDIT*\n\nChoose the environment variable you want to update in \`${project.project_name}\`:`;

    const keyboard: InlineKeyboardButton[][] = envs.map((e) => [
      createSafeButton(`✏️ ${e.key}`, `proj:env_edit_item:${projectId}:${e.id}`),
    ]);

    keyboard.push([createSafeButton('🔙 Back to Env List', `proj:env:${projectId}`)]);

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
  } catch (error: any) {
    console.error('Error loading env edit list:', error);
  }
}

/**
 * Prompts user for the new value of the chosen variable
 */
export async function handleEnvEditItemPrompt(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  envId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Access denied.', show_alert: true });
    return;
  }

  await answerCallbackQuery(callbackQuery.id);

  try {
    const envs = await getVercelEnvVariables(project.vercel_project);
    const targetEnv = envs.find((e) => e.id === envId);

    if (!targetEnv) {
      await answerCallbackQuery(callbackQuery.id, { text: 'Variable not found.', show_alert: true });
      return;
    }

    // Set state
    await setUserState(from.id, 'WAITING_ENV_EDIT_VALUE', {
      project_id: projectId,
      env_id: envId,
      env_key: targetEnv.key,
      vercel_project: project.vercel_project,
    });

    const promptText = `✏️ *EDIT VARIABLE: \`${targetEnv.key}\`*

📦 *Project:* \`${project.project_name}\`
▲ *Target:* Vercel Environment Variables

━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Please send the new value for \`${targetEnv.key}\`:*

_The updated value will be saved directly in Vercel._`;

    const keyboard = [
      [createSafeButton('❌ Cancel', `proj:env:${projectId}`)],
    ];

    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, promptText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await sendMessage(chatId, promptText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error: any) {
    console.error('Error in env edit prompt:', error);
  }
}

/**
 * Handles incoming new value for the edited variable
 */
export async function handleEnvEditInput(message: TelegramMessage, newValue: string) {
  const from = message.from;
  if (!from) return;

  const stateRecord = await getUserState(from.id);
  const tempData = stateRecord.temp_data || {};
  const projectId = tempData.project_id;
  const envId = tempData.env_id;
  const envKey = tempData.env_key;
  const vercelProject = tempData.vercel_project;

  if (!projectId || !envId || !envKey || !vercelProject) {
    await clearUserState(from.id);
    await sendMessage(
      message.chat.id,
      `⚠️ *Session Expired*\n\nPlease select the project again from *📂 My Projects*.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await clearUserState(from.id);
    await sendMessage(message.chat.id, `❌ Access denied or project not found.`);
    return;
  }

  let cleanValue = newValue.trim();
  // Strip optional quotes
  if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) || (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
    cleanValue = cleanValue.slice(1, -1);
  }

  const statusMsg = await sendMessage(
    message.chat.id,
    `⏳ *Updating \`${envKey}\` on Vercel...*`,
    { parse_mode: 'Markdown' }
  );
  const statusMsgId = statusMsg.result?.message_id;

  try {
    await editVercelEnvVariable(vercelProject, envId, cleanValue);
    await clearUserState(from.id);

    await logSystemAction(from.id, 'ENV_EDITED', 'SUCCESS', projectId, `Edited ${envKey}`);

    const successText = `✅ *VARIABLE UPDATED ON VERCEL!*

📦 *Project:* \`${project.project_name}\`
🔑 *Variable:* \`${envKey}\`
🟢 *Status:* Successfully updated in Vercel

━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 *Redeploy to apply this new value to your live website:*`;

    const keyboard = [
      [createSafeButton('🚀 Redeploy Website', `proj:redeploy:${projectId}`)],
      [
        createSafeButton('⚙️ View All Variables', `proj:env:${projectId}`),
        createSafeButton('📦 Project Details', `proj:details:${projectId}`),
      ],
    ];

    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, successText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await sendMessage(message.chat.id, successText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (error: any) {
    console.error('Error updating env variable:', error);
    await clearUserState(from.id);

    const errText = `❌ *Failed to update variable*\n\n*Error:* ${error?.message || 'Vercel API error'}`;
    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, errText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[createSafeButton('⚙️ Back to Env Variables', `proj:env:${projectId}`)]],
        },
      });
    } else {
      await sendMessage(message.chat.id, errText, { parse_mode: 'Markdown' });
    }
  }
}

/**
 * Handles "🗑 Delete Variable" — Lists variables to pick which to delete
 */
export async function handleEnvDeleteList(
  callbackQuery: TelegramCallbackQuery,
  projectId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Access denied.', show_alert: true });
    return;
  }

  await answerCallbackQuery(callbackQuery.id);

  try {
    const envs = await getVercelEnvVariables(project.vercel_project);
    if (envs.length === 0) {
      await answerCallbackQuery(callbackQuery.id, { text: 'No variables to delete.', show_alert: true });
      return;
    }

    const text = `🗑 *SELECT VARIABLE TO DELETE*\n\nChoose an environment variable to permanently remove from \`${project.project_name}\`:`;

    const keyboard: InlineKeyboardButton[][] = envs.map((e) => [
      createSafeButton(`🗑 Delete ${e.key}`, `proj:env_del_confirm:${projectId}:${e.id}`),
    ]);

    keyboard.push([createSafeButton('🔙 Back to Env List', `proj:env:${projectId}`)]);

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
  } catch (error: any) {
    console.error('Error loading env delete list:', error);
  }
}

/**
 * Handles deleting the confirmed variable from Vercel
 */
export async function handleEnvDeleteConfirm(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  envId: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Access denied.', show_alert: true });
    return;
  }

  await answerCallbackQuery(callbackQuery.id, { text: 'Deleting variable from Vercel...' });

  try {
    await deleteVercelEnvVariable(project.vercel_project, envId);
    await logSystemAction(from.id, 'ENV_DELETED', 'SUCCESS', projectId, `Deleted env id ${envId}`);

    // Refresh env list view
    await handleEnvList(callbackQuery, projectId);
  } catch (error: any) {
    console.error('Error deleting env variable:', error);
    await answerCallbackQuery(callbackQuery.id, {
      text: `Failed to delete: ${error?.message || 'Vercel API error'}`,
      show_alert: true,
    });
  }
}
