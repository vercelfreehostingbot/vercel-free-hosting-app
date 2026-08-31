// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — DEPLOYMENT PIPELINE HANDLER
// =================================================================

import { CONFIG, getTodayDateString } from '../../lib/config';
import {
  getUser,
  getUserState,
  setUserState,
  clearUserState,
  incrementUserUsage,
  checkProjectNameExists,
  saveProject,
  getProject,
  logSystemAction,
} from '../../lib/firebase';
import {
  sendMessage,
  editMessageText,
  downloadTelegramFile,
  deleteMessage,
  answerCallbackQuery,
} from '../../lib/telegram';
import { processAndAnalyzeZip, ExtractedFile } from '../../lib/zip';
import { validateProjectName } from '../../lib/security';
import { createGitHubRepository, uploadFilesToGitHub, getGitHubRepoId } from '../../lib/github';
import {
  getOrCreateVercelProject,
  createVercelDeployment,
  pollVercelDeployment,
} from '../../lib/vercel';
import { getProjectActionKeyboard, getMainMenuKeyboard } from '../keyboards';
import { TelegramMessage, TelegramCallbackQuery, ProjectRecord } from '../../types';

// In-memory cache for temporary extracted files during user project name naming step
const pendingZipFilesCache = new Map<number, { files: ExtractedFile[]; analysis: any }>();

/**
 * Triggered when user presses "🚀 Deploy Website"
 */
export async function handleDeployPrompt(message: TelegramMessage) {
  const from = message.from;
  if (!from) return;

  const user = await getUser(from.id);
  if (user?.banned) {
    await sendMessage(
      message.chat.id,
      `🚫 *ACCOUNT SUSPENDED*\n\nYour account has been suspended by administrator.`
    );
    return;
  }

  // Check daily limit (5 per day)
  const today = getTodayDateString();
  const usage = user?.daily_usage_date === today ? user.daily_usage || 0 : 0;
  if (usage >= CONFIG.DEFAULT_DAILY_LIMIT && user?.role !== 'super_admin' && user?.role !== 'admin') {
    await sendMessage(
      message.chat.id,
      `⚠️ *DAILY LIMIT REACHED*\n\nYou have used *${usage} / ${CONFIG.DEFAULT_DAILY_LIMIT}* deployments for today.\n\nYour limit will automatically reset tomorrow.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Set user state to WAITING_ZIP
  await setUserState(from.id, 'WAITING_ZIP');

  const promptText = `📦 *DEPLOY WEBSITE*

Please upload your website or web project as a *ZIP file* (.zip).

• *Supported:* Next.js, Vite, React, Vue, Svelte, Astro, HTML/CSS, Node.js
• *Max Size:* ${CONFIG.MAX_ZIP_SIZE_MB}MB
• *Security:* Sensitive \`.env\` files and credentials will be automatically excluded.`;

  await sendMessage(message.chat.id, promptText, { parse_mode: 'Markdown' });
}

/**
 * Handles ZIP file upload from user
 */
export async function handleZipUpload(message: TelegramMessage) {
  const from = message.from;
  if (!from || !message.document) return;

  const doc = message.document;
  const fileName = doc.file_name || '';

  if (!fileName.toLowerCase().endsWith('.zip') && doc.mime_type !== 'application/zip') {
    await sendMessage(
      message.chat.id,
      `❌ *Invalid File*\n\nPlease upload a valid *.zip* file.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const statusMsg = await sendMessage(
    message.chat.id,
    `⏳ *Processing ZIP File...*\n\nDownloading and scanning archive for security...`,
    { parse_mode: 'Markdown' }
  );

  const statusMsgId = statusMsg.result?.message_id;

  try {
    // 1. Download ZIP buffer from Telegram
    const zipBuffer = await downloadTelegramFile(doc.file_id);

    // 2. Extract & Validate ZIP
    const { analysis, files } = await processAndAnalyzeZip(zipBuffer);

    if (!analysis.compatible) {
      const errorReason = analysis.incompatibleReason || 'This project is not compatible with Vercel.';
      if (statusMsgId) {
        await editMessageText(
          message.chat.id,
          statusMsgId,
          `❌ *Unsupported Project*\n\n${errorReason}`
        );
      }
      await clearUserState(from.id);
      return;
    }

    // Store in pending cache for project name step
    pendingZipFilesCache.set(from.id, { files, analysis });

    // Update state to WAITING_PROJECT_NAME
    await setUserState(from.id, 'WAITING_PROJECT_NAME', {
      file_name: fileName,
      detected_framework: analysis.framework,
      file_count: files.length,
    });

    const analysisText = `📦 *PROJECT ANALYSIS*

• *Framework:* ${analysis.framework}
• *Package Manager:* ${analysis.packageManager}
• *Files Detected:* ${files.length}
• *Vercel Compatibility:* ✅ Compatible

━━━━━━━━━━━━━━━━━━━
📝 *Enter your Project Name:*

(Use lowercase letters, numbers, and hyphens. Example: \`my-portfolio\`)`;

    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, analysisText, {
        parse_mode: 'Markdown',
      });
    } else {
      await sendMessage(message.chat.id, analysisText, { parse_mode: 'Markdown' });
    }
  } catch (error: any) {
    console.error('ZIP processing error:', error);
    const errMsg = `❌ *ZIP Extraction Failed*\n\n${error?.message || 'Something went wrong while processing the archive.'}`;
    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, errMsg, { parse_mode: 'Markdown' });
    } else {
      await sendMessage(message.chat.id, errMsg, { parse_mode: 'Markdown' });
    }
    await clearUserState(from.id);
  }
}

/**
 * Handles project name input and executes full deployment flow
 */
export async function handleProjectNameInput(message: TelegramMessage, rawName: string) {
  const from = message.from;
  if (!from) return;

  const validation = validateProjectName(rawName);
  if (!validation.valid) {
    await sendMessage(
      message.chat.id,
      `❌ *Invalid Project Name*\n\n${validation.error}\n\nPlease enter another project name:`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const projectName = validation.normalized;

  // Check if project name already exists for this user
  const exists = await checkProjectNameExists(projectName, from.id);
  if (exists) {
    await sendMessage(
      message.chat.id,
      `❌ *Project Name Already Exists*\n\nYou already have a project named \`${projectName}\`.\n\nPlease choose another name:`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Retrieve cached files
  const cached = pendingZipFilesCache.get(from.id);
  if (!cached || !cached.files || cached.files.length === 0) {
    await sendMessage(
      message.chat.id,
      `⚠️ Session expired. Please send your ZIP file again by clicking *🚀 Deploy Website*.`,
      { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() }
    );
    await clearUserState(from.id);
    return;
  }

  const { files, analysis } = cached;

  // Clear state and cache
  await clearUserState(from.id);
  pendingZipFilesCache.delete(from.id);

  // Send single progress message
  let progressMessageText = `🚀 *DEPLOYMENT IN PROGRESS*

📦 *Project:* \`${projectName}\`
🔧 *Framework:* ${analysis.framework}

📦 Upload: ✅
🔍 Analysis: ✅
🐙 GitHub: ⏳
▲ Vercel: ⏳
⚙️ Build: ⏳`;

  const progressMsg = await sendMessage(message.chat.id, progressMessageText, {
    parse_mode: 'Markdown',
  });
  const progressMsgId = progressMsg.result?.message_id;

  const updateProgress = async (text: string) => {
    if (progressMsgId) {
      try {
        await editMessageText(message.chat.id, progressMsgId, text, {
          parse_mode: 'Markdown',
        });
      } catch (e) {
        // Ignore Telegram edit rate limit errors
      }
    }
  };

  try {
    // 1. Create GitHub Repository
    updateProgress(`🚀 *DEPLOYMENT IN PROGRESS*

📦 *Project:* \`${projectName}\`
🔧 *Framework:* ${analysis.framework}

📦 Upload: ✅
🔍 Analysis: ✅
🐙 GitHub: ⏳ Creating repository...
▲ Vercel: ⏳
⚙️ Build: ⏳`);

    const repo = await createGitHubRepository(projectName, false);

    // 2. Upload files to GitHub
    updateProgress(`🚀 *DEPLOYMENT IN PROGRESS*

📦 *Project:* \`${projectName}\`
🔧 *Framework:* ${analysis.framework}

📦 Upload: ✅
🔍 Analysis: ✅
🐙 GitHub: ⏳ Uploading ${files.length} files...
▲ Vercel: ⏳
⚙️ Build: ⏳`);

    const gitUpload = await uploadFilesToGitHub(projectName, files);

    // 3. Create Vercel Project
    updateProgress(`🚀 *DEPLOYMENT IN PROGRESS*

📦 *Project:* \`${projectName}\`
🔧 *Framework:* ${analysis.framework}

📦 Upload: ✅
🔍 Analysis: ✅
🐙 GitHub: ✅
▲ Vercel: ⏳ Initializing deployment...
⚙️ Build: ⏳`);

    await getOrCreateVercelProject(projectName, analysis, projectName);

    // 4. Create Vercel Deployment (pointing to verified main branch & commit SHA, with direct files fallback)
    const deployment = await createVercelDeployment(
      projectName,
      projectName,
      gitUpload.branch || 'main',
      repo.id,
      files,
      gitUpload.commit_sha,
      analysis
    );

    // 5. Monitor Vercel Build
    updateProgress(`🚀 *DEPLOYMENT IN PROGRESS*

📦 *Project:* \`${projectName}\`
🔧 *Framework:* ${analysis.framework}

📦 Upload: ✅
🔍 Analysis: ✅
🐙 GitHub: ✅
▲ Vercel: ✅
⚙️ Build: ⏳ Building & compiling...`);

    const pollResult = await pollVercelDeployment(deployment.deploymentId, projectName, async (state) => {
      updateProgress(`🚀 *DEPLOYMENT IN PROGRESS*

📦 *Project:* \`${projectName}\`
🔧 *Framework:* ${analysis.framework}

📦 Upload: ✅
🔍 Analysis: ✅
🐙 GitHub: ✅
▲ Vercel: ✅
⚙️ Build: ⏳ ${state}...`);
    });

    if (pollResult.status === 'ERROR' || pollResult.status === 'CANCELED') {
      throw new Error(pollResult.error || 'Vercel build failed.');
    }

    const liveUrl = pollResult.liveUrl || deployment.url;
    const projectId = `proj_${Date.now()}_${projectName}`;

    // 6. Save Project Record to Firebase
    const projectRecord: ProjectRecord = {
      project_id: projectId,
      user_id: from.id,
      project_name: projectName,
      github_repository: `${CONFIG.GITHUB_USERNAME}/${projectName}`,
      github_url: repo.html_url,
      vercel_project: projectName,
      vercel_url: liveUrl,
      deployment_id: deployment.deploymentId,
      framework: analysis.framework,
      status: 'ONLINE',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await saveProject(projectRecord);
    await incrementUserUsage(from.id);
    await logSystemAction(from.id, 'PROJECT_DEPLOYED', 'SUCCESS', projectId, projectName);

    // 7. Send Success Message
    const successText = `🎉 *WEBSITE DEPLOYED SUCCESSFULLY!*

📦 *Project:* \`${projectName}\`
🔧 *Framework:* ${analysis.framework}
🐙 *GitHub:* Connected
▲ *Vercel:* Connected
🟢 *Status:* Online

🌐 *Live Website:*
${liveUrl}`;

    if (progressMsgId) {
      await editMessageText(message.chat.id, progressMsgId, successText, {
        parse_mode: 'Markdown',
        reply_markup: getProjectActionKeyboard(projectId, liveUrl),
      });
    } else {
      await sendMessage(message.chat.id, successText, {
        parse_mode: 'Markdown',
        reply_markup: getProjectActionKeyboard(projectId, liveUrl),
      });
    }
  } catch (error: any) {
    console.error('Deployment failure:', error);
    await logSystemAction(from.id, 'PROJECT_DEPLOYED', 'FAILED', undefined, error?.message);

    const failText = `❌ *Deployment Failed*

*Error:* ${error?.message || 'Failed to complete deployment.'}

Please check your project structure and try again.`;

    if (progressMsgId) {
      await editMessageText(message.chat.id, progressMsgId, failText, {
        parse_mode: 'Markdown',
      });
    } else {
      await sendMessage(message.chat.id, failText, { parse_mode: 'Markdown' });
    }
  }
}

/**
 * Triggered when user clicks "📦 Update via ZIP" on a project
 */
export async function handleProjectZipUpdatePrompt(
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

  // Set user state to WAITING_PROJECT_ZIP_UPDATE
  await setUserState(from.id, 'WAITING_PROJECT_ZIP_UPDATE', {
    project_id: projectId,
    project_name: project.project_name,
  });

  const promptText = `📦 *UPDATE PROJECT VIA FULL ZIP*

• *Target Project:* \`${project.project_name}\`
• *GitHub Repo:* \`${project.github_repository}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 *Please upload your updated project as a .zip file attachment:*

• All nested folders, subfolders, HTML, CSS, JS, assets, and configs will be synced and updated.
• Old files will be replaced with your new structure.
• A fresh build will immediately deploy to Vercel.
• Maximum ZIP Size: ${CONFIG.MAX_ZIP_SIZE_MB}MB`;

  const keyboard = [
    [{ text: '❌ Cancel Update', callback_data: `proj:details:${projectId}` }],
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
 * Handles incoming ZIP upload when user is in WAITING_PROJECT_ZIP_UPDATE state
 */
export async function handleProjectZipUpdate(message: TelegramMessage) {
  const from = message.from;
  if (!from || !message.document) return;

  const userState = await getUserState(from.id);
  const projectId = userState.temp_data?.project_id;

  if (!projectId) {
    await clearUserState(from.id);
    await sendMessage(message.chat.id, `❌ Update session expired. Please select your project again.`);
    return;
  }

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await clearUserState(from.id);
    await sendMessage(message.chat.id, `❌ Project not found or permission denied.`);
    return;
  }

  const doc = message.document;
  const fileName = doc.file_name || '';

  if (!fileName.toLowerCase().endsWith('.zip') && doc.mime_type !== 'application/zip') {
    await sendMessage(
      message.chat.id,
      `❌ *Invalid File*\n\nPlease upload a valid *.zip* file containing your updated project.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const statusMsg = await sendMessage(
    message.chat.id,
    `⏳ *Processing Updated Project ZIP...*\n\n1️⃣ Downloading archive...\n2️⃣ Scanning nested folders & files...`,
    { parse_mode: 'Markdown' }
  );

  const statusMsgId = statusMsg.result?.message_id;

  const updateProgress = async (text: string) => {
    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, text, { parse_mode: 'Markdown' });
    }
  };

  try {
    // 1. Download ZIP buffer
    const zipBuffer = await downloadTelegramFile(doc.file_id);

    // 2. Extract & Validate ZIP
    const { analysis, files } = await processAndAnalyzeZip(zipBuffer);

    if (!analysis.compatible) {
      const errorReason = analysis.incompatibleReason || 'This project structure is not compatible with Vercel.';
      await updateProgress(`❌ *Unsupported Project Structure*\n\n${errorReason}`);
      await clearUserState(from.id);
      return;
    }

    await updateProgress(`⏳ *Syncing ${files.length} Files with GitHub...*\n\nUpdating repository \`${project.github_repository}\`...`);

    // 3. Commit new files to GitHub repository
    await uploadFilesToGitHub(
      project.project_name,
      files,
      `Update complete project via Telegram Bot ZIP upload (${files.length} files)`
    );

    await updateProgress(`⏳ *Deploying to Vercel...*\n\n▲ Vercel: Initializing fresh production build...`);

    // 4. Trigger Vercel Deployment
    const repoId = await getGitHubRepoId(project.project_name);
    const deployment = await createVercelDeployment(
      project.vercel_project,
      project.project_name,
      'main',
      repoId || undefined,
      files
    );

    // 5. Poll Deployment
    const pollResult = await pollVercelDeployment(deployment.deploymentId, project.project_name, async (state) => {
      await updateProgress(`🔄 *BUILDING ON VERCEL...*\n\n📦 Project: \`${project.project_name}\`\n▲ Status: ${state}...`);
    });

    if (pollResult.status === 'ERROR' || pollResult.status === 'CANCELED') {
      throw new Error(pollResult.error || 'Vercel build failed.');
    }

    const liveUrl = project.custom_domain
      ? `https://${project.custom_domain}`
      : pollResult.liveUrl || deployment.url;

    // 6. Update Project Record in Firebase
    project.framework = analysis.framework;
    project.deployment_id = deployment.deploymentId;
    project.vercel_url = liveUrl;
    project.status = 'ONLINE';
    project.updated_at = Date.now();

    await saveProject(project);
    await clearUserState(from.id);
    await logSystemAction(from.id, 'PROJECT_UPDATED_VIA_ZIP', 'SUCCESS', projectId, `Updated ${files.length} files`);

    const successText = `🎉 *PROJECT SUCCESSFULLY UPDATED!*

📦 *Project:* \`${project.project_name}\`
📂 *Files Updated:* ${files.length}
🔧 *Framework:* ${analysis.framework}
🟢 *Status:* Online

🌐 *Live Website:*
${liveUrl}`;

    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, successText, {
        parse_mode: 'Markdown',
        reply_markup: getProjectActionKeyboard(projectId, liveUrl),
      });
    } else {
      await sendMessage(message.chat.id, successText, {
        parse_mode: 'Markdown',
        reply_markup: getProjectActionKeyboard(projectId, liveUrl),
      });
    }
  } catch (err: any) {
    console.error('ZIP Project Update failed:', err);
    await logSystemAction(from.id, 'PROJECT_UPDATED_VIA_ZIP', 'FAILED', projectId, err?.message);

    const failText = `❌ *Update Failed*\n\n${err?.message || 'Could not update project from ZIP.'}`;
    await updateProgress(failText);
  }
}

