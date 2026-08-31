// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — GITHUB REST API CLIENT
// =================================================================

import { CONFIG } from './config';
import { ExtractedFile } from './zip';

const GITHUB_API = 'https://api.github.com';

function getHeaders() {
  const token = CONFIG.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN environment variable is missing.');

  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Vercel-Free-Hosting-Telegram-Bot',
  };
}

/**
 * Creates or retrieves a GitHub repository under GITHUB_USERNAME
 */
export async function createGitHubRepository(
  repoName: string,
  isPrivate = false
): Promise<{
  id: number;
  owner: string;
  repo: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
}> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME environment variable is missing.');

  const headers = getHeaders();

  // Step 1: Check if repo already exists
  const checkRes = await fetch(`${GITHUB_API}/repos/${username}/${repoName}`, {
    method: 'GET',
    headers,
  });

  if (checkRes.status === 200) {
    const existing = await checkRes.json();
    return {
      id: existing.id,
      owner: username,
      repo: repoName,
      html_url: existing.html_url,
      clone_url: existing.clone_url,
      default_branch: existing.default_branch || 'main',
    };
  }

  // Step 2: Create new repo with auto_init to ensure non-empty initial state
  const createRes = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: repoName,
      description: `Deployed via @${CONFIG.BOT_USERNAME} on Telegram`,
      private: isPrivate,
      auto_init: true, // Initializes with main branch and README
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json();
    throw new Error(`GitHub repo creation failed: ${err.message || createRes.statusText}`);
  }

  const data = await createRes.json();

  // Ensure default branch is main
  try {
    await fetch(`${GITHUB_API}/repos/${username}/${repoName}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_branch: 'main' }),
    });
  } catch (e) {
    // Non-fatal
  }

  return {
    id: data.id,
    owner: username,
    repo: repoName,
    html_url: data.html_url,
    clone_url: data.clone_url,
    default_branch: data.default_branch || 'main',
  };
}

/**
 * Retrieves numerical GitHub repository ID by repo name
 */
export async function getGitHubRepoId(repoName: string): Promise<number | null> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) return null;
  const headers = getHeaders();

  try {
    const res = await fetch(`${GITHUB_API}/repos/${username}/${repoName}`, {
      method: 'GET',
      headers,
    });
    if (res.ok) {
      const data = await res.json();
      return data.id || null;
    }
  } catch (error) {
    console.warn(`Could not get GitHub repo ID for ${repoName}:`, error);
  }
  return null;
}

/**
 * Downloads GitHub repository archive as a Buffer
 */
export async function downloadGitHubRepoZip(repoName: string, branch = 'main'): Promise<Buffer> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME is missing');
  const headers = getHeaders();

  // Try specific branch first, then main, then master
  const branches = [branch, 'main', 'master'];
  for (const b of branches) {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${username}/${repoName}/zipball/${b}`, {
        method: 'GET',
        headers,
        redirect: 'follow',
      });
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch (e) {
      console.warn(`[GITHUB] Download zipball for branch ${b} failed:`, e);
    }
  }

  // Fallback: download default branch
  const defaultRes = await fetch(`${GITHUB_API}/repos/${username}/${repoName}/zipball`, {
    method: 'GET',
    headers,
    redirect: 'follow',
  });

  if (!defaultRes.ok) {
    throw new Error(`Failed to download repository files from GitHub for ${repoName}`);
  }

  const arrayBuf = await defaultRes.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Uploads project files to GitHub using Git Tree, Blobs, and Commit API.
 * Ensures the 'main' branch exists, contains all project files, and is the default branch.
 */
export async function uploadFilesToGitHub(
  repoName: string,
  files: ExtractedFile[],
  commitMessage = 'Deploy project from Telegram Bot'
): Promise<{ commit_sha: string; tree_sha: string; branch: string }> {
  const username = CONFIG.GITHUB_USERNAME;
  const headers = getHeaders();
  const repoUrl = `${GITHUB_API}/repos/${username}/${repoName}`;

  if (!files || files.length === 0) {
    throw new Error('Cannot upload to GitHub: No project files provided.');
  }

  // 1. Get reference to target branch (always prefer 'main')
  const targetBranch = 'main';
  let latestCommitSha = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    const refRes = await fetch(`${repoUrl}/git/refs/heads/${targetBranch}`, { headers });
    if (refRes.ok) {
      const refData = await refRes.json();
      latestCommitSha = refData.object?.sha || '';
      if (latestCommitSha) break;
    } else {
      // Check if master branch exists
      const masterRes = await fetch(`${repoUrl}/git/refs/heads/master`, { headers });
      if (masterRes.ok) {
        const masterData = await masterRes.json();
        latestCommitSha = masterData.object?.sha || '';
        if (latestCommitSha) break;
      }
    }
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  // 2. Create blobs for files in batches
  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];

  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const cleanPath = file.relativePath.replace(/^[\\\/]+/, '');
          if (!cleanPath) return;

          const contentEncoding = file.isText ? 'utf-8' : 'base64';
          const content = file.isText
            ? file.content !== undefined
              ? file.content
              : file.buffer.toString('utf-8')
            : file.buffer.toString('base64');

          const blobRes = await fetch(`${repoUrl}/git/blobs`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              encoding: contentEncoding,
            }),
          });

          if (!blobRes.ok) {
            console.warn(`Failed to create blob for ${cleanPath}: ${blobRes.statusText}`);
            return;
          }

          const blobData = await blobRes.json();
          treeItems.push({
            path: cleanPath,
            mode: '100644', // standard file
            type: 'blob',
            sha: blobData.sha,
          });
        } catch (e) {
          console.warn(`Error uploading file blob for ${file.relativePath}:`, e);
        }
      })
    );
  }

  if (treeItems.length === 0) {
    throw new Error('No files could be processed for GitHub upload.');
  }

  // 3. Create tree representing exact project snapshot
  const treePayload: any = {
    tree: treeItems,
  };

  const treeRes = await fetch(`${repoUrl}/git/trees`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(treePayload),
  });

  if (!treeRes.ok) {
    const err = await treeRes.json();
    throw new Error(`Failed to create GitHub tree: ${err.message || treeRes.statusText}`);
  }
  const treeData = await treeRes.json();

  // 4. Create commit
  const commitPayload: any = {
    message: commitMessage,
    tree: treeData.sha,
  };
  if (latestCommitSha) {
    commitPayload.parents = [latestCommitSha];
  }

  const commitRes = await fetch(`${repoUrl}/git/commits`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(commitPayload),
  });

  if (!commitRes.ok) {
    const err = await commitRes.json();
    throw new Error(`Failed to create GitHub commit: ${err.message || commitRes.statusText}`);
  }
  const commitData = await commitRes.json();

  // 5. Update or create branch reference for 'main'
  let refUpdated = false;
  const updateRefRes = await fetch(`${repoUrl}/git/refs/heads/${targetBranch}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sha: commitData.sha,
      force: true,
    }),
  });

  if (updateRefRes.ok) {
    refUpdated = true;
  } else {
    // If refs/heads/main doesn't exist, create it
    const createRefRes = await fetch(`${repoUrl}/git/refs`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${targetBranch}`,
        sha: commitData.sha,
      }),
    });

    if (createRefRes.ok) {
      refUpdated = true;
    } else {
      console.warn(`Could not create refs/heads/${targetBranch}, trying force update:`, await createRefRes.text());
    }
  }

  // 6. Ensure default branch is set to 'main'
  try {
    await fetch(repoUrl, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_branch: targetBranch }),
    });
  } catch (e) {
    // Ignore if already default
  }

  // 7. Verify and wait for GitHub to propagate the commit and branch reference
  for (let i = 0; i < 4; i++) {
    try {
      const verifyRes = await fetch(`${repoUrl}/commits/${commitData.sha}`, { headers });
      if (verifyRes.ok) {
        break;
      }
    } catch (e) {
      // Non-blocking retry
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  return {
    commit_sha: commitData.sha,
    tree_sha: treeData.sha,
    branch: targetBranch,
  };
}

/**
 * Deletes a GitHub repository
 */
export async function deleteGitHubRepository(repoName: string): Promise<boolean> {
  const username = CONFIG.GITHUB_USERNAME;
  const headers = getHeaders();

  try {
    const res = await fetch(`${GITHUB_API}/repos/${username}/${repoName}`, {
      method: 'DELETE',
      headers,
    });
    return res.status === 204 || res.status === 404;
  } catch (error) {
    console.error(`Failed to delete GitHub repository ${repoName}:`, error);
    return false;
  }
}

export interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
  download_url?: string;
}

/**
 * Retrieves repository contents (files & folders) at a given path
 */
export async function getRepoContents(
  repoName: string,
  path = '',
  branch = 'main'
): Promise<GitHubContentItem[]> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME is missing');
  const headers = getHeaders();

  const cleanRepo = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
  const cleanPath = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = `${GITHUB_API}/repos/${username}/${cleanRepo}/contents/${cleanPath}?ref=${branch}`;

  let res = await fetch(url, {
    method: 'GET',
    headers,
  });

  // If failed on 'main', try without branch or 'master'
  if (!res.ok && branch === 'main') {
    const fallbackUrl = `${GITHUB_API}/repos/${username}/${cleanRepo}/contents/${cleanPath}`;
    const fallbackRes = await fetch(fallbackUrl, { method: 'GET', headers });
    if (fallbackRes.ok) {
      res = fallbackRes;
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to list repository contents: ${err.message || res.statusText}`);
  }

  const data = await res.json();

  if (Array.isArray(data)) {
    return data
      .map((item: any) => ({
        name: item.name,
        path: item.path,
        type: item.type === 'dir' ? ('dir' as const) : ('file' as const),
        size: item.size || 0,
        sha: item.sha,
        download_url: item.download_url,
      }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });
  }

  return [];
}

/**
 * Retrieves specific file content from GitHub repository
 */
export async function getFileContent(
  repoName: string,
  path: string,
  branch = 'main'
): Promise<{
  path: string;
  name: string;
  content: string;
  sha: string;
  size: number;
  isBinary: boolean;
}> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME is missing');
  const headers = getHeaders();

  const cleanRepo = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
  const cleanPath = path.replace(/^\/+/, '');
  const url = `${GITHUB_API}/repos/${username}/${cleanRepo}/contents/${cleanPath}?ref=${branch}`;

  let res = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!res.ok && branch === 'main') {
    const fallbackUrl = `${GITHUB_API}/repos/${username}/${cleanRepo}/contents/${cleanPath}`;
    const fallbackRes = await fetch(fallbackUrl, { method: 'GET', headers });
    if (fallbackRes.ok) {
      res = fallbackRes;
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to fetch file content: ${err.message || res.statusText}`);
  }

  const data = await res.json();

  if (data.type !== 'file') {
    throw new Error(`Path '${path}' is not a regular file.`);
  }

  let textContent = '';
  let isBinary = false;

  if (data.content && data.encoding === 'base64') {
    const buffer = Buffer.from(data.content, 'base64');
    // Check if binary (contains null bytes)
    if (buffer.slice(0, 1000).includes(0)) {
      isBinary = true;
      textContent = '[Binary File - Cannot be edited as plain text]';
    } else {
      textContent = buffer.toString('utf-8');
    }
  }

  return {
    path: data.path,
    name: data.name,
    content: textContent,
    sha: data.sha,
    size: data.size || 0,
    isBinary,
  };
}

/**
 * Updates or creates a file directly in GitHub repository with automatic SHA resolution
 */
export async function updateFileInGitHub(
  repoName: string,
  path: string,
  newContent: string | Buffer,
  fileSha?: string,
  branch = 'main',
  commitMessage?: string
): Promise<{
  commit_sha: string;
  updated: boolean;
}> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME is missing');
  const headers = getHeaders();

  const cleanRepo = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
  const cleanPath = path.replace(/^\/+/, '');
  const url = `${GITHUB_API}/repos/${username}/${cleanRepo}/contents/${cleanPath}`;

  const base64Content = Buffer.isBuffer(newContent)
    ? newContent.toString('base64')
    : Buffer.from(newContent, 'utf-8').toString('base64');

  // Helper to attempt PUT with a given SHA
  const putFile = async (sha?: string) => {
    const bodyPayload: any = {
      message: commitMessage || `Update ${cleanPath} via Telegram Bot`,
      content: base64Content,
      branch,
    };
    if (sha) {
      bodyPayload.sha = sha;
    }

    return fetch(url, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });
  };

  // Attempt initial update
  let res = await putFile(fileSha);

  // If failed due to stale/mismatched SHA or 409/422 conflict, fetch latest live SHA and retry
  if (!res.ok) {
    const errText = await res.text();
    let errJson: any = {};
    try {
      errJson = JSON.parse(errText);
    } catch (e) {
      // not JSON
    }

    const errMsg = errJson.message || errText || res.statusText;
    const isConflict =
      res.status === 409 ||
      res.status === 422 ||
      errMsg.includes('does not match') ||
      errMsg.includes('conflict') ||
      errMsg.includes('sha');

    if (isConflict) {
      try {
        const fresh = await getFileContent(cleanRepo, cleanPath, branch);
        if (fresh && fresh.sha) {
          res = await putFile(fresh.sha);
          if (!res.ok) {
            const retryErr = await res.json().catch(() => ({}));
            throw new Error(`GitHub file update failed: ${retryErr.message || res.statusText}`);
          }
        } else {
          throw new Error(`GitHub file update failed: ${errMsg}`);
        }
      } catch (innerErr: any) {
        throw new Error(`GitHub file update failed: ${innerErr?.message || errMsg}`);
      }
    } else {
      throw new Error(`GitHub file update failed: ${errMsg}`);
    }
  }

  const data = await res.json();

  return {
    commit_sha: data.commit?.sha || '',
    updated: true,
  };
}

/**
 * Deletes a file directly in GitHub repository
 */
export async function deleteFileInGitHub(
  repoName: string,
  path: string,
  fileSha?: string,
  branch = 'main',
  commitMessage?: string
): Promise<{
  commit_sha: string;
  deleted: boolean;
}> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME is missing');
  const headers = getHeaders();

  const cleanRepo = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
  const cleanPath = path.replace(/^\/+/, '');
  const url = `${GITHUB_API}/repos/${username}/${cleanRepo}/contents/${cleanPath}`;

  let shaToDelete = fileSha;
  if (!shaToDelete) {
    const file = await getFileContent(cleanRepo, cleanPath, branch);
    shaToDelete = file.sha;
  }

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage || `Delete ${cleanPath} via Telegram Bot`,
      sha: shaToDelete,
      branch,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub file deletion failed: ${err.message || res.statusText}`);
  }

  const data = await res.json();
  return {
    commit_sha: data.commit?.sha || '',
    deleted: true,
  };
}

/**
 * Creates a new folder in GitHub repository by initializing an entry file (e.g. .gitkeep or index file)
 */
export async function createFolderInGitHub(
  repoName: string,
  folderPath: string,
  initialFileName = '.gitkeep',
  initialFileContent = '',
  branch = 'main',
  commitMessage?: string
): Promise<{
  commit_sha: string;
  folderPath: string;
}> {
  const cleanFolder = folderPath.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '');
  if (!cleanFolder) {
    throw new Error('Folder path cannot be empty.');
  }

  const targetFilePath = `${cleanFolder}/${initialFileName.replace(/^[\/\\]+/, '')}`;
  const result = await updateFileInGitHub(
    repoName,
    targetFilePath,
    initialFileContent,
    undefined,
    branch,
    commitMessage || `Create folder ${cleanFolder} via Telegram Bot`
  );

  return {
    commit_sha: result.commit_sha,
    folderPath: cleanFolder,
  };
}

/**
 * Deletes an entire folder and all its nested files/subfolders in GitHub repository
 */
export async function deleteFolderInGitHub(
  repoName: string,
  folderPath: string,
  branch = 'main',
  commitMessage?: string
): Promise<{
  commit_sha: string;
  deletedFilesCount: number;
}> {
  const username = CONFIG.GITHUB_USERNAME;
  if (!username) throw new Error('GITHUB_USERNAME is missing');
  const headers = getHeaders();

  const cleanRepo = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
  const cleanFolder = folderPath.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '');
  if (!cleanFolder) {
    throw new Error('Cannot delete root repository folder.');
  }

  const repoUrl = `${GITHUB_API}/repos/${username}/${cleanRepo}`;

  // 1. Try atomic Git Tree deletion if possible
  try {
    // Get latest commit on branch
    let latestCommitSha = '';
    const refRes = await fetch(`${repoUrl}/git/refs/heads/${branch}`, { headers });
    if (refRes.ok) {
      const refData = await refRes.json();
      latestCommitSha = refData.object?.sha || '';
    }

    if (latestCommitSha) {
      // Get the full recursive tree
      const treeRes = await fetch(`${repoUrl}/git/trees/${latestCommitSha}?recursive=1`, { headers });
      if (treeRes.ok) {
        const treeData = await treeRes.json();
        const allItems: Array<{ path: string; mode: string; type: string; sha: string }> = treeData.tree || [];

        const folderPrefix = `${cleanFolder}/`;
        const matchedFiles = allItems.filter(
          (item) => item.path === cleanFolder || item.path.startsWith(folderPrefix)
        );

        if (matchedFiles.length > 0) {
          const remainingItems = allItems
            .filter((item) => item.path !== cleanFolder && !item.path.startsWith(folderPrefix))
            .filter((item) => item.type === 'blob') // Only include blobs for complete tree
            .map((item) => ({
              path: item.path,
              mode: item.mode,
              type: item.type,
              sha: item.sha,
            }));

          // If all files in the entire repo would be deleted, keep a README
          if (remainingItems.length === 0) {
            const readmeBlobRes = await fetch(`${repoUrl}/git/blobs`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: `# ${cleanRepo}\n\nCleaned up via Telegram Bot.`,
                encoding: 'utf-8',
              }),
            });
            if (readmeBlobRes.ok) {
              const rData = await readmeBlobRes.json();
              remainingItems.push({
                path: 'README.md',
                mode: '100644',
                type: 'blob',
                sha: rData.sha,
              });
            }
          }

          // Create new tree
          const newTreeRes = await fetch(`${repoUrl}/git/trees`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tree: remainingItems,
            }),
          });

          if (newTreeRes.ok) {
            const newTreeData = await newTreeRes.json();

            // Create commit
            const commitRes = await fetch(`${repoUrl}/git/commits`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: commitMessage || `Delete folder ${cleanFolder} via Telegram Bot`,
                tree: newTreeData.sha,
                parents: [latestCommitSha],
              }),
            });

            if (commitRes.ok) {
              const commitData = await commitRes.json();

              // Update branch ref
              await fetch(`${repoUrl}/git/refs/heads/${branch}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sha: commitData.sha,
                  force: true,
                }),
              });

              return {
                commit_sha: commitData.sha,
                deletedFilesCount: matchedFiles.length,
              };
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[GITHUB] Atomic tree folder deletion encountered error, falling back to sequential delete:`, err);
  }

  // 2. Fallback: Recursive file retrieval and deletion
  async function collectFilesRecursively(subPath: string): Promise<string[]> {
    const list = await getRepoContents(cleanRepo, subPath, branch);
    let files: string[] = [];
    for (const item of list) {
      if (item.type === 'file') {
        files.push(item.path);
      } else if (item.type === 'dir') {
        const subFiles = await collectFilesRecursively(item.path);
        files = files.concat(subFiles);
      }
    }
    return files;
  }

  const filesToDelete = await collectFilesRecursively(cleanFolder);
  let lastCommitSha = '';
  let count = 0;

  for (const filePath of filesToDelete) {
    try {
      const res = await deleteFileInGitHub(
        cleanRepo,
        filePath,
        undefined,
        branch,
        commitMessage || `Delete ${filePath} in folder ${cleanFolder}`
      );
      lastCommitSha = res.commit_sha;
      count++;
    } catch (e) {
      console.warn(`Could not delete file ${filePath} in folder:`, e);
    }
  }

  return {
    commit_sha: lastCommitSha,
    deletedFilesCount: count,
  };
}



