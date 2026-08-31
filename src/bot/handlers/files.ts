// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — GITHUB CODE & FILE MANAGER HANDLER
// =================================================================

import { getProject, getUserState, clearUserState, setUserState, logSystemAction } from '../../lib/firebase';
import { sendMessage, editMessageText, answerCallbackQuery, downloadTelegramFile } from '../../lib/telegram';
import {
  getRepoContents,
  getFileContent,
  updateFileInGitHub,
  deleteFileInGitHub,
  createFolderInGitHub,
  deleteFolderInGitHub,
  GitHubContentItem,
} from '../../lib/github';
import { createSafeButton } from '../../lib/callbackCache';
import { autoHealPackageJsonString } from '../../lib/zip';
import { TelegramCallbackQuery, TelegramMessage, InlineKeyboardButton } from '../../types';

export function getFileIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return '🌐';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) return '🎨';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return '⚡';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return '🔷';
  if (lower.endsWith('.vue')) return '💚';
  if (lower.endsWith('.svelte')) return '🧡';
  if (lower.endsWith('.astro')) return '🚀';
  if (lower.endsWith('.py') || lower.endsWith('.pyi') || lower.endsWith('.ipynb')) return '🐍';
  if (lower.endsWith('.php') || lower.endsWith('.phtml')) return '🐘';
  if (lower.endsWith('.go') || lower === 'go.mod' || lower === 'go.sum') return '🦫';
  if (lower.endsWith('.rs') || lower === 'cargo.toml') return '🦀';
  if (lower.endsWith('.rb') || lower.endsWith('.erb') || lower === 'gemfile') return '💎';
  if (lower.endsWith('.java') || lower.endsWith('.kt') || lower.endsWith('.kts')) return '☕';
  if (lower.endsWith('.c') || lower.endsWith('.cpp') || lower.endsWith('.h') || lower.endsWith('.hpp') || lower.endsWith('.cs')) return '⚙️';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return '💻';
  if (lower.endsWith('.sql') || lower.endsWith('.graphql') || lower.endsWith('.prisma')) return '🗄️';
  if (lower.endsWith('.json') || lower.endsWith('.json5') || lower.endsWith('.jsonc')) return '📦';
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.txt') || lower.endsWith('.log')) return '📝';
  if (
    lower.endsWith('.svg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.bmp')
  ) {
    return '🖼️';
  }
  if (
    lower.endsWith('.mp4') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.avi') ||
    lower.endsWith('.mkv') ||
    lower.endsWith('.m4v')
  ) {
    return '🎬';
  }
  if (
    lower.endsWith('.mp3') ||
    lower.endsWith('.wav') ||
    lower.endsWith('.ogg') ||
    lower.endsWith('.m4a') ||
    lower.endsWith('.flac') ||
    lower.endsWith('.aac')
  ) {
    return '🎵';
  }
  if (lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.gz') || lower.endsWith('.rar')) {
    return '🗜️';
  }
  if (
    lower === 'dockerfile' ||
    lower.startsWith('.env') ||
    lower.includes('config') ||
    lower === '.gitignore' ||
    lower === 'vercel.json' ||
    lower.endsWith('.toml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml')
  ) {
    return '⚙️';
  }
  return '📄';
}

/**
 * Handles "📁 Files / Edit Code" callback — Lists files/directories in GitHub repo
 */
export async function handleProjectFiles(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  targetPath = ''
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

  await answerCallbackQuery(callbackQuery.id, { text: 'Loading GitHub repository files...' });

  try {
    const cleanPath = targetPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const items = await getRepoContents(project.project_name, cleanPath);

    const displayPath = cleanPath ? `/${cleanPath}` : '/ (root)';
    let text = `📁 *PROJECT FILE MANAGER*\n\n`;
    text += `📦 *Project:* \`${project.project_name}\`\n`;
    text += `📂 *Current Directory:* \`${displayPath}\`\n`;
    text += `🐙 *GitHub Repo:* \`${project.github_repository}\`\n\n`;
    text += `_Select a file to view/edit/delete, or tap \`➕ Add / Upload File\` to add any new file/video/image:_`;

    const keyboard: InlineKeyboardButton[][] = [];

    // Add File & New Folder Buttons at top
    keyboard.push([
      createSafeButton(
        '➕ Add File',
        cleanPath ? `proj:file_add_prompt:${projectId}:${cleanPath}` : `proj:file_add_prompt:${projectId}`
      ),
      createSafeButton(
        '📁➕ New Folder',
        cleanPath ? `proj:folder_add_prompt:${projectId}:${cleanPath}` : `proj:folder_add_prompt:${projectId}`
      ),
    ]);

    // If inside a subfolder, add 'Up / Parent' button and 'Delete Folder' button
    if (cleanPath) {
      const parts = cleanPath.split('/').filter(Boolean);
      parts.pop();
      const parentPath = parts.join('/');
      keyboard.push([
        createSafeButton(
          '⬆️ 📁 Up to Parent',
          parentPath ? `proj:files:${projectId}:${parentPath}` : `proj:files:${projectId}`
        ),
        createSafeButton(
          '🗑 Delete Folder',
          `proj:folder_delete_confirm:${projectId}:${cleanPath}`
        ),
      ]);
    }

    // List directories and files
    for (const item of items) {
      if (item.type === 'dir') {
        keyboard.push([
          createSafeButton(`📁 ${item.name}/`, `proj:files:${projectId}:${item.path}`),
        ]);
      } else {
        const icon = getFileIcon(item.name);
        const sizeKb = (item.size / 1024).toFixed(1);
        keyboard.push([
          createSafeButton(`${icon} ${item.name} (${sizeKb} KB)`, `proj:file_view:${projectId}:${item.path}`),
        ]);
      }
    }

    if (items.length === 0) {
      text += `\n\n_(This directory is empty)_`;
    }

    // Footer actions
    keyboard.push([
      createSafeButton('🔄 Refresh', cleanPath ? `proj:files:${projectId}:${cleanPath}` : `proj:files:${projectId}`),
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
    console.error('Error fetching repo contents:', error);
    const errText = `❌ *Failed to load GitHub files*\n\n${error?.message || 'Could not access repository files on GitHub.'}`;
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
 * Handles viewing a single file's content (code preview or binary media info)
 */
export async function handleFileView(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  filePath: string
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

  await answerCallbackQuery(callbackQuery.id, { text: 'Fetching file content...' });

  try {
    const file = await getFileContent(project.project_name, filePath);

    // Derive parent directory path for "Back" button
    const pathParts = filePath.split('/').filter(Boolean);
    pathParts.pop();
    const parentPath = pathParts.join('/');

    const icon = getFileIcon(file.name);
    const sizeKb = (file.size / 1024).toFixed(1);

    let text = `${icon} *FILE: \`${file.path}\`*\n`;
    text += `📦 *Project:* \`${project.project_name}\`\n`;
    text += `📊 *Size:* ${sizeKb} KB\n`;
    text += `🐙 *GitHub:* \`${project.github_repository}/${file.path}\`\n\n`;

    if (file.isBinary) {
      const lower = file.name.toLowerCase();
      let mediaType = 'Binary Asset';
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.ico')) {
        mediaType = '🖼 Image File';
      } else if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv')) {
        mediaType = '🎬 Video File';
      } else if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg')) {
        mediaType = '🎵 Audio File';
      }

      text += `📁 *Type:* ${mediaType}\n`;
      text += `💡 _This is a media/binary file. You can replace it with a new file or delete it below:_`;
    } else {
      const maxPreviewLen = 2500;
      let previewContent = file.content;
      let isTruncated = false;

      if (previewContent.length > maxPreviewLen) {
        previewContent = previewContent.slice(0, maxPreviewLen);
        isTruncated = true;
      }

      // Safe escape triple backticks inside code preview
      const safePreview = previewContent.replace(/```/g, '` ` `');
      text += `📄 *Current Content:*\n\`\`\`\n${safePreview}\n\`\`\`\n`;
      if (isTruncated) {
        text += `\n_⚠️ File preview truncated (${sizeKb} KB total). Tapping Edit will replace the entire file._\n`;
      }
    }

    const keyboard: InlineKeyboardButton[][] = [];

    // Edit/Replace and Delete Row
    keyboard.push([
      createSafeButton(file.isBinary ? '📤 Replace File' : '✏️ Edit Code / Replace', `proj:file_edit:${projectId}:${filePath}`),
      createSafeButton('🗑 Delete File', `proj:file_delete_confirm:${projectId}:${filePath}`),
    ]);

    keyboard.push([
      createSafeButton('📁 Back to Directory', parentPath ? `proj:files:${projectId}:${parentPath}` : `proj:files:${projectId}`),
      createSafeButton('📦 Project Menu', `proj:details:${projectId}`),
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
    console.error('Error viewing file:', error);
    const errText = `❌ *Failed to read file*\n\n${error?.message || 'Could not fetch file content from GitHub.'}`;
    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, errText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[createSafeButton('🔙 Back to Files', `proj:files:${projectId}`)]],
        },
      });
    }
  }
}

/**
 * Handles prompting user to enter new code/content for editing an existing file
 */
export async function handleFileEditPrompt(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  filePath: string
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

  try {
    let fileSha: string | undefined;
    try {
      const file = await getFileContent(project.project_name, filePath);
      fileSha = file.sha;
    } catch (e) {
      // ignore
    }

    // Set state to WAITING_FILE_EDIT_CONTENT
    await setUserState(from.id, 'WAITING_FILE_EDIT_CONTENT', {
      project_id: projectId,
      file_path: filePath,
      file_sha: fileSha || '',
      repo_name: project.project_name,
    });

    const promptText = `✏️ *EDIT / REPLACE FILE: \`${filePath}\`*

📦 *Project:* \`${project.project_name}\`
🐙 *GitHub Target:* \`${project.github_repository}/${filePath}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *আপডেট করার উপায়:*

1️⃣ *ফাইল/ইমেজ/ভিডিও আপলোড:* নতুন ফাইলটি টেলিগ্রামে পাঠিয়ে দিন (Document, Photo, Video, ইত্যাদি)।
2️⃣ *কোড পেস্ট করে:* আপনার নতুন কোডটি মেসেজ হিসেবে পেস্ট করে পাঠান।

💡 _ফাইল সরাসরি GitHub-এ কমিট হবে।_`;

    const keyboard = [
      [createSafeButton('❌ Cancel', `proj:file_view:${projectId}:${filePath}`)],
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
    console.error('Error preparing file edit:', error);
    await sendMessage(chatId, `❌ Failed to prepare file for editing: ${error?.message}`);
  }
}

/**
 * Handles Prompt for 📁➕ Creating a New Folder
 */
export async function handleFolderAddPrompt(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  targetDir = ''
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

  const cleanDir = targetDir.replace(/^\/+/, '').replace(/\/+$/, '');
  const displayDir = cleanDir ? `/${cleanDir}` : '/ (root)';

  // Set user state to WAITING_FOLDER_NAME
  await setUserState(from.id, 'WAITING_FOLDER_NAME', {
    project_id: projectId,
    target_dir: cleanDir,
    repo_name: project.project_name,
  });

  const promptText = `📁 *CREATE NEW FOLDER / নতুন ফোল্ডার তৈরি করুন*

📦 *Project:* \`${project.project_name}\`
📂 *Current Location:* \`${displayDir}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 *যে ফোল্ডার তৈরি করতে চান তার নাম লিখে পাঠান:*
• উদাহরণ ১: \`api\`
• উদাহরণ ২: \`components\`
• উদাহরণ ৩: \`public/images\`
• উদাহরণ ৪: সরাসরি ফাইল সহ ফোল্ডার: \`api/submit.txt\`

💡 _ফোল্ডার তৈরি হওয়ার পর আপনি সরাসরি সেই ফোল্ডারে নতুন ফাইল যোগ ও এডিট করতে পারবেন।_`;

  const keyboard = [
    [createSafeButton('❌ Cancel', cleanDir ? `proj:files:${projectId}:${cleanDir}` : `proj:files:${projectId}`)],
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
 * Handles Text input when creating a new folder (or nested file)
 */
export async function handleFolderAddNameInput(message: TelegramMessage, folderNameInput: string) {
  const from = message.from;
  if (!from) return;

  const stateRecord = await getUserState(from.id);
  const tempData = stateRecord.temp_data || {};
  const projectId = tempData.project_id;
  const targetDir = tempData.target_dir || '';
  const repoName = tempData.repo_name;

  if (!projectId || !repoName) {
    await clearUserState(from.id);
    await sendMessage(message.chat.id, `⚠️ Session expired. Please open files from *📂 My Projects*.`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  let cleanInput = folderNameInput.trim().replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '');
  if (!cleanInput || cleanInput.includes('..') || /[\<\>\"\'\|\?\*]/.test(cleanInput)) {
    await sendMessage(
      message.chat.id,
      `❌ *Invalid folder name.*\nPlease provide a valid name like \`api\`, \`components\`, or \`public/images\`.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Combine targetDir if relative
  let fullPath = cleanInput;
  if (targetDir && !cleanInput.startsWith(targetDir)) {
    fullPath = `${targetDir}/${cleanInput}`;
  }
  fullPath = fullPath.replace(/^\/+/, '');

  // Check if input looks like a direct file (has a file extension like .txt, .js, .html, .py, etc.)
  const lastSegment = fullPath.split('/').pop() || '';
  if (lastSegment.includes('.') && !lastSegment.startsWith('.')) {
    // User gave a filename directly in folder input (e.g. `api/submit.txt`) -> Route to file creation
    await setUserState(from.id, 'WAITING_FILE_ADD_CONTENT', {
      project_id: projectId,
      file_path: fullPath,
      repo_name: repoName,
    });

    const promptText = `📄 *CREATING FILE: \`${fullPath}\`*

📦 *Target:* \`${repoName}/${fullPath}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Now send the file content:*
• কোড বা টেক্সট লিখে মেসেজ হিসেবে পাঠান।
• অথবা ফাইল/ইমেজ সরাসরি আপলোড করে দিন।`;

    const keyboard = [
      [createSafeButton('❌ Cancel', targetDir ? `proj:files:${projectId}:${targetDir}` : `proj:files:${projectId}`)],
    ];

    await sendMessage(message.chat.id, promptText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  // Create the folder in GitHub with .gitkeep placeholder
  const statusMsg = await sendMessage(
    message.chat.id,
    `⏳ *Creating folder \`${fullPath}/\` on GitHub...*`,
    { parse_mode: 'Markdown' }
  );

  try {
    const res = await createFolderInGitHub(repoName, fullPath, '.gitkeep', '');
    await clearUserState(from.id);
    await logSystemAction(from.id, 'FOLDER_CREATED', 'SUCCESS', projectId, `Created folder ${fullPath}`);

    const successText = `📁 *FOLDER CREATED SUCCESSFULLY!*

📂 *New Folder:* \`/${fullPath}\`
📦 *Project:* \`${repoName}\`
🔖 *Commit:* \`${res.commit_sha ? res.commit_sha.slice(0, 7) : 'Created'}\`
🟢 *Status:* Folder is ready on GitHub!

━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 *Now you can open this folder and add your files (like \`submit.txt\`):*`;

    const keyboard: InlineKeyboardButton[][] = [
      [
        createSafeButton('📂 Open This Folder', `proj:files:${projectId}:${fullPath}`),
        createSafeButton('➕ Add File In Folder', `proj:file_add_prompt:${projectId}:${fullPath}`),
      ],
      [
        createSafeButton('📁 Root Files', `proj:files:${projectId}`),
        createSafeButton('📦 Project Details', `proj:details:${projectId}`),
      ],
    ];

    if (statusMsg.result?.message_id) {
      await editMessageText(message.chat.id, statusMsg.result.message_id, successText, {
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
    console.error('Error creating folder in GitHub:', error);
    await clearUserState(from.id);
    const errText = `❌ *Failed to create folder on GitHub*\n\n*Error:* ${error?.message || 'Could not create folder.'}`;
    if (statusMsg.result?.message_id) {
      await editMessageText(message.chat.id, statusMsg.result.message_id, errText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[createSafeButton('📁 Back to Files', `proj:files:${projectId}`)]],
        },
      });
    } else {
      await sendMessage(message.chat.id, errText, { parse_mode: 'Markdown' });
    }
  }
}

/**
 * Confirmation dialog before deleting an entire folder
 */
export async function handleFolderDeleteConfirm(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  folderPath: string
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

  const cleanFolder = folderPath.replace(/^\/+/, '').replace(/\/+$/, '');
  const text = `⚠️ *DELETE FOLDER CONFIRMATION*

Are you sure you want to permanently delete this entire folder and all files inside it?

📁 *Folder to Delete:* \`/${cleanFolder}\`
📦 *Project:* \`${project.project_name}\`
🐙 *GitHub Repository:* \`${project.github_repository}\`

_⚠️ This folder and all nested files/subfolders will be permanently removed from GitHub._`;

  const keyboard: InlineKeyboardButton[][] = [
    [
      createSafeButton('🔥 Yes, Delete Entire Folder', `proj:folder_delete_exec:${projectId}:${cleanFolder}`),
      createSafeButton('❌ Cancel', `proj:files:${projectId}:${cleanFolder}`),
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
 * Executes folder deletion directly on GitHub
 */
export async function handleFolderDeleteExecute(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  folderPath: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Access denied or project not found.', show_alert: true });
    return;
  }

  const cleanFolder = folderPath.replace(/^\/+/, '').replace(/\/+$/, '');
  await answerCallbackQuery(callbackQuery.id, { text: `Deleting folder /${cleanFolder}...` });

  // Derive parent directory path for "Back" button
  const pathParts = cleanFolder.split('/').filter(Boolean);
  pathParts.pop();
  const parentPath = pathParts.join('/');

  try {
    const result = await deleteFolderInGitHub(project.project_name, cleanFolder);
    await logSystemAction(from.id, 'FOLDER_DELETED', 'SUCCESS', projectId, `Deleted folder ${cleanFolder} (${result.deletedFilesCount} files)`);

    const successText = `🗑 *FOLDER DELETED SUCCESSFULLY!*

📁 *Deleted Folder:* \`/${cleanFolder}\`
📊 *Files Removed:* ${result.deletedFilesCount}
🐙 *Repository:* \`${project.github_repository}\`
🔖 *Commit:* \`${result.commit_sha ? result.commit_sha.slice(0, 7) : 'Deleted'}\`
🟢 *Status:* Folder removed from GitHub

━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 *Redeploy your website now to apply changes to your live Vercel site:*`;

    const keyboard: InlineKeyboardButton[][] = [
      [createSafeButton('🚀 Redeploy Website', `proj:redeploy:${projectId}`)],
      [
        createSafeButton('📁 Back to Files', parentPath ? `proj:files:${projectId}:${parentPath}` : `proj:files:${projectId}`),
        createSafeButton('📦 Project Details', `proj:details:${projectId}`),
      ],
    ];

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
  } catch (error: any) {
    console.error('Error deleting folder from GitHub:', error);
    const errText = `❌ *Failed to delete folder from GitHub*\n\n*Error:* ${error?.message || 'Could not delete folder.'}`;
    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, errText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[createSafeButton('📁 Back to Files', `proj:files:${projectId}`)]],
        },
      });
    }
  }
}

/**
 * Handles Prompt for ➕ Adding a New File (Any file, image, video, code)
 */
export async function handleFileAddPrompt(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  targetDir = ''
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

  const cleanDir = targetDir.replace(/^\/+/, '').replace(/\/+$/, '');
  const displayDir = cleanDir ? `/${cleanDir}` : '/ (root)';

  // Set user state to WAITING_FILE_ADD_SELECT
  await setUserState(from.id, 'WAITING_FILE_ADD_SELECT', {
    project_id: projectId,
    target_dir: cleanDir,
    repo_name: project.project_name,
  });

  const promptText = `➕ *ADD NEW FILE / নতুন ফাইল যুক্ত করুন*

📦 *Project:* \`${project.project_name}\`
📂 *Target Location:* \`${displayDir}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 *পদ্ধতি ১ (সরাসরি ফাইল বা মিডিয়া আপলোড):*
যেকোনো ফাইল টেলিগ্রামে পাঠিয়ে দিন (যেমন: \`config.js\`, ছবি \`logo.png\`, ভিডিও \`intro.mp4\`, বা কোনো ডকুমেন্ট)। এটি স্বয়ংক্রিয়ভাবে \`${displayDir}\` ফোল্ডারে যুক্ত হয়ে যাবে।

👉 *পদ্ধতি ২ (নতুন ফাইলের নাম টাইপ করে):*
আপনি যে ফাইলের নাম তৈরি করতে চান তা লিখে মেসেজ দিন (যেমন: \`submit.txt\`, \`api/submit.txt\`, \`config.js\` বা \`assets/header.css\`)।`;

  const keyboard = [
    [createSafeButton('❌ Cancel', cleanDir ? `proj:files:${projectId}:${cleanDir}` : `proj:files:${projectId}`)],
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
 * Handles Text input when creating a new file by specifying its filename
 */
export async function handleFileAddNameInput(message: TelegramMessage, fileNameInput: string) {
  const from = message.from;
  if (!from) return;

  const stateRecord = await getUserState(from.id);
  const tempData = stateRecord.temp_data || {};
  const projectId = tempData.project_id;
  const targetDir = tempData.target_dir || '';
  const repoName = tempData.repo_name;

  if (!projectId || !repoName) {
    await clearUserState(from.id);
    await sendMessage(message.chat.id, `⚠️ Session expired. Please open files from *📂 My Projects*.`, { parse_mode: 'Markdown' });
    return;
  }

  const cleanName = fileNameInput.trim().replace(/^[\/\\]+/, '');
  if (!cleanName || cleanName.includes('..') || /[\<\>\"\'\|\?\*]/.test(cleanName)) {
    await sendMessage(message.chat.id, `❌ *Invalid filename.*\nPlease provide a valid name like \`config.js\`, \`style.css\`, or \`data.json\`.`, { parse_mode: 'Markdown' });
    return;
  }

  // Combine targetDir with cleanName
  let fullPath = cleanName;
  if (targetDir && !cleanName.startsWith(targetDir)) {
    fullPath = `${targetDir}/${cleanName}`;
  }
  fullPath = fullPath.replace(/^\/+/, '');

  // Advance state to WAITING_FILE_ADD_CONTENT
  await setUserState(from.id, 'WAITING_FILE_ADD_CONTENT', {
    project_id: projectId,
    file_path: fullPath,
    repo_name: repoName,
  });

  const promptText = `📄 *CREATING FILE: \`${fullPath}\`*

📦 *Target:* \`${repoName}/${fullPath}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Now send the file content:*
• কোড বা টেক্সট লিখে মেসেজ হিসেবে পাঠান।
• অথবা ফাইল/ইমেজ সরাসরি আপলোড করে দিন।`;

  const keyboard = [
    [createSafeButton('❌ Cancel', `proj:files:${projectId}:${targetDir}`)],
  ];

  await sendMessage(message.chat.id, promptText, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Handles incoming content for new file creation
 */
export async function handleFileAddContentInput(message: TelegramMessage, newContent: string) {
  let cleaned = (newContent || '').trim();

  // If user pasted code wrapped in markdown code fence (```js ... ```), unwrap it
  const codeBlockMatch = cleaned.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1];
  }

  return executeGitHubFileUpdate(message, cleaned, 'text');
}

/**
 * Handles incoming content for editing an existing file
 */
export async function handleFileEditContentInput(message: TelegramMessage, newContent: string) {
  let cleaned = (newContent || '').trim();

  // If user pasted code wrapped in markdown code fence (```js ... ```), unwrap it
  const codeBlockMatch = cleaned.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1];
  }

  return executeGitHubFileUpdate(message, cleaned, 'text');
}

/**
 * Confirmation dialog before deleting a file
 */
export async function handleFileDeleteConfirm(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  filePath: string
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

  const icon = getFileIcon(filePath);
  const text = `⚠️ *DELETE FILE CONFIRMATION*

Are you sure you want to permanently delete this file?

${icon} *File:* \`${filePath}\`
📦 *Project:* \`${project.project_name}\`
🐙 *GitHub Repository:* \`${project.github_repository}\`

_⚠️ This file will be permanently removed from your GitHub repository._`;

  const keyboard: InlineKeyboardButton[][] = [
    [
      createSafeButton('🔥 Yes, Permanently Delete', `proj:file_delete_exec:${projectId}:${filePath}`),
      createSafeButton('❌ Cancel', `proj:file_view:${projectId}:${filePath}`),
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
 * Executes file deletion directly on GitHub
 */
export async function handleFileDeleteExecute(
  callbackQuery: TelegramCallbackQuery,
  projectId: string,
  filePath: string
) {
  const from = callbackQuery.from;
  const chatId = callbackQuery.message?.chat.id || from.id;

  const project = await getProject(projectId);
  if (!project || project.user_id !== from.id) {
    await answerCallbackQuery(callbackQuery.id, { text: 'Access denied or project not found.', show_alert: true });
    return;
  }

  await answerCallbackQuery(callbackQuery.id, { text: `Deleting ${filePath}...` });

  // Derive parent directory path for "Back" button
  const pathParts = filePath.split('/').filter(Boolean);
  pathParts.pop();
  const parentPath = pathParts.join('/');

  try {
    const result = await deleteFileInGitHub(project.project_name, filePath);
    await logSystemAction(from.id, 'FILE_DELETED', 'SUCCESS', projectId, `Deleted ${filePath}`);

    const successText = `🗑 *FILE DELETED SUCCESSFULLY!*

📄 *Deleted File:* \`${filePath}\`
🐙 *Repository:* \`${project.github_repository}\`
🔖 *Commit:* \`${result.commit_sha ? result.commit_sha.slice(0, 7) : 'Deleted'}\`
🟢 *Status:* File removed from GitHub

━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 *Redeploy your website now to apply the changes to your live Vercel site:*`;

    const keyboard: InlineKeyboardButton[][] = [
      [createSafeButton('🚀 Redeploy Website', `proj:redeploy:${projectId}`)],
      [
        createSafeButton('📁 Back to Files', parentPath ? `proj:files:${projectId}:${parentPath}` : `proj:files:${projectId}`),
        createSafeButton('📦 Project Details', `proj:details:${projectId}`),
      ],
    ];

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
  } catch (error: any) {
    console.error('Error deleting file from GitHub:', error);
    const errText = `❌ *Failed to delete file from GitHub*\n\n*Error:* ${error?.message || 'Could not delete file.'}`;
    if (callbackQuery.message) {
      await editMessageText(chatId, callbackQuery.message.message_id, errText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[createSafeButton('📁 Back to Files', `proj:files:${projectId}`)]],
        },
      });
    }
  }
}

/**
 * Common handler to save or create file directly in GitHub (in-memory buffer -> GitHub)
 */
async function executeGitHubFileUpdate(
  message: TelegramMessage,
  newContent: string | Buffer,
  sourceType: 'text' | 'document' | 'photo' | 'video' | 'audio',
  uploadedFileName?: string
) {
  const from = message.from;
  if (!from) return;

  const stateRecord = await getUserState(from.id);
  const tempData = stateRecord.temp_data || {};

  const projectId = tempData.project_id;
  let filePath = tempData.file_path;
  const targetDir = tempData.target_dir || '';
  const fileSha = tempData.file_sha;
  const repoName = tempData.repo_name;

  // If no specific file_path was set yet (e.g. from WAITING_FILE_ADD_SELECT), use uploadedFileName
  if (!filePath && uploadedFileName) {
    filePath = targetDir ? `${targetDir}/${uploadedFileName}` : uploadedFileName;
  }
  filePath = (filePath || '').replace(/^\/+/, '');

  if (!projectId || !filePath || !repoName) {
    await clearUserState(from.id);
    await sendMessage(
      message.chat.id,
      `⚠️ *Session Expired*\n\nPlease select your project again from *📂 My Projects*.`,
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

  const statusMsg = await sendMessage(
    message.chat.id,
    `⏳ *Saving directly to GitHub...*\n\nPushing \`${filePath}\` to \`${project.github_repository}\`...`,
    { parse_mode: 'Markdown' }
  );
  const statusMsgId = statusMsg.result?.message_id;

  try {
    let finalContent = newContent;
    if (
      (filePath.toLowerCase() === 'package.json' || filePath.toLowerCase().endsWith('/package.json')) &&
      typeof newContent === 'string'
    ) {
      finalContent = autoHealPackageJsonString(newContent);
    }

    const commitMsg =
      sourceType === 'text'
        ? `Update ${filePath} via Telegram Bot`
        : `Upload ${filePath} (${sourceType}) via Telegram Bot`;

    const result = await updateFileInGitHub(
      repoName,
      filePath,
      finalContent,
      fileSha || undefined,
      'main',
      commitMsg
    );

    // Clear user state
    await clearUserState(from.id);

    // Log action
    await logSystemAction(from.id, 'FILE_SAVED', 'SUCCESS', projectId, `Saved ${filePath}`);

    const icon = getFileIcon(filePath);
    const successText = `💾 *FILE COMMITTED TO GITHUB!*

${icon} *File:* \`${filePath}\`
🐙 *Repository:* \`${project.github_repository}\`
🔖 *Commit:* \`${result.commit_sha ? result.commit_sha.slice(0, 7) : 'Success'}\`
🟢 *Status:* Saved & Committed directly to GitHub

━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 *Redeploy your website now to publish your changes on Vercel:*`;

    // Derive parent directory path for "Back" button
    const pathParts = filePath.split('/').filter(Boolean);
    pathParts.pop();
    const parentPath = pathParts.join('/');

    const keyboard = [
      [createSafeButton('🚀 Redeploy Website', `proj:redeploy:${projectId}`)],
      [
        createSafeButton('📁 Back to Files', parentPath ? `proj:files:${projectId}:${parentPath}` : `proj:files:${projectId}`),
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
    console.error('Error saving file to GitHub:', error);
    await clearUserState(from.id);

    const errText = `❌ *Failed to commit file to GitHub*\n\n*Error:* ${error?.message || 'Could not save file to GitHub.'}\n\nPlease try again.`;
    if (statusMsgId) {
      await editMessageText(message.chat.id, statusMsgId, errText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [createSafeButton('📁 Back to Files', `proj:files:${projectId}`)],
          ],
        },
      });
    } else {
      await sendMessage(message.chat.id, errText, { parse_mode: 'Markdown' });
    }
  }
}

/**
 * Handles incoming replacement or new document file (e.g. index.html, logo.png, style.css)
 */
export async function handleFileEditDocumentInput(message: TelegramMessage) {
  const doc = message.document;
  if (!doc) return;

  // Max 25MB single file limit
  if (doc.file_size && doc.file_size > 25 * 1024 * 1024) {
    await sendMessage(message.chat.id, `❌ File too large. Maximum size for single file upload is 25MB.`);
    return;
  }

  try {
    const fileBuffer = await downloadTelegramFile(doc.file_id);
    return executeGitHubFileUpdate(message, fileBuffer, 'document', doc.file_name);
  } catch (err: any) {
    console.error('Error downloading uploaded edit file:', err);
    await sendMessage(message.chat.id, `❌ Could not download attached file: ${err?.message}`);
  }
}

/**
 * Handles incoming photo / image uploads (PNG, JPG, WebP)
 */
export async function handleFilePhotoUpload(message: TelegramMessage) {
  const photos = message.photo;
  if (!photos || photos.length === 0) return;

  // Pick largest resolution photo
  const bestPhoto = photos[photos.length - 1];

  try {
    const fileBuffer = await downloadTelegramFile(bestPhoto.file_id);
    const fileName = `image_${Date.now()}.jpg`;
    return executeGitHubFileUpdate(message, fileBuffer, 'photo', fileName);
  } catch (err: any) {
    console.error('Error downloading uploaded photo:', err);
    await sendMessage(message.chat.id, `❌ Could not download photo: ${err?.message}`);
  }
}

/**
 * Handles incoming video uploads (MP4, WebM, MOV)
 */
export async function handleFileVideoUpload(message: TelegramMessage) {
  const video = message.video;
  if (!video) return;

  // Max 25MB single video limit
  if (video.file_size && video.file_size > 25 * 1024 * 1024) {
    await sendMessage(message.chat.id, `❌ Video too large. Maximum size for upload is 25MB.`);
    return;
  }

  try {
    const fileBuffer = await downloadTelegramFile(video.file_id);
    const fileName = video.file_name || `video_${Date.now()}.mp4`;
    return executeGitHubFileUpdate(message, fileBuffer, 'video', fileName);
  } catch (err: any) {
    console.error('Error downloading uploaded video:', err);
    await sendMessage(message.chat.id, `❌ Could not download video: ${err?.message}`);
  }
}

/**
 * Handles incoming audio uploads (MP3, WAV, etc.)
 */
export async function handleFileAudioUpload(message: TelegramMessage) {
  const audio = message.audio;
  if (!audio) return;

  try {
    const fileBuffer = await downloadTelegramFile(audio.file_id);
    const fileName = audio.file_name || `audio_${Date.now()}.mp3`;
    return executeGitHubFileUpdate(message, fileBuffer, 'audio', fileName);
  } catch (err: any) {
    console.error('Error downloading uploaded audio:', err);
    await sendMessage(message.chat.id, `❌ Could not download audio: ${err?.message}`);
  }
}
