// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — VERCEL REST API CLIENT
// =================================================================

import { CONFIG } from './config';
import { ProjectAnalysis } from '../types';
import { ExtractedFile, processAndAnalyzeZip } from './zip';
import { getGitHubRepoId, downloadGitHubRepoZip } from './github';

const VERCEL_API = 'https://api.vercel.com';

function getHeaders() {
  const token = CONFIG.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN environment variable is missing.');

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function getQueryString() {
  if (CONFIG.VERCEL_TEAM_ID) {
    return `?teamId=${CONFIG.VERCEL_TEAM_ID}`;
  }
  return '';
}

/**
 * Returns the clean canonical production URL for a Vercel project (e.g. https://my-project.vercel.app)
 */
export function getCanonicalProjectUrl(
  projectName: string,
  customDomain?: string,
  aliases?: string[]
): string {
  if (customDomain) {
    const cleanDomain = customDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return `https://${cleanDomain}`;
  }

  if (aliases && aliases.length > 0) {
    // 1. Look for exact <projectName>.vercel.app
    const exactAlias = aliases.find((a) => a === `${projectName}.vercel.app`);
    if (exactAlias) return `https://${exactAlias}`;

    // 2. Look for any alias without the long random deployment hash
    const cleanAlias = aliases.find((a) => {
      if (a.endsWith('.vercel.app')) {
        // Exclude hashes like project-abc123xyz-team.vercel.app
        const parts = a.replace('.vercel.app', '').split('-');
        return parts.length <= 2 || !/\d[a-z0-9]{6,}/i.test(a);
      }
      return true; // custom domain alias
    });
    if (cleanAlias) return `https://${cleanAlias}`;
  }

  return `https://${projectName}.vercel.app`;
}

/**
 * Creates or retrieves a Vercel project and links it to GitHub
 */
export async function getOrCreateVercelProject(
  projectName: string,
  analysis: ProjectAnalysis,
  githubRepoName?: string
): Promise<{
  id: string;
  name: string;
}> {
  const headers = getHeaders();
  const teamQuery = getQueryString();
  const username = CONFIG.GITHUB_USERNAME;

  // Map framework preset if supported
  const frameworkMap: Record<string, string> = {
    'Next.js': 'nextjs',
    'Vue.js': 'vue',
    'Nuxt.js': 'nuxtjs',
    'Remix': 'remix',
    'Astro': 'astro',
    'SvelteKit': 'sveltekit',
    'React (Vite)': 'vite',
    'Vite Project': 'vite',
    'Vite': 'vite',
    'Angular': 'angular',
  };

  const preset = frameworkMap[analysis.framework];

  // Check if project exists
  const checkRes = await fetch(`${VERCEL_API}/v9/projects/${projectName}${teamQuery}`, {
    method: 'GET',
    headers,
  });

  if (checkRes.status === 200) {
    const data = await checkRes.json();
    return { id: data.id, name: data.name };
  }

  // Create Project payload
  const payload: any = {
    name: projectName,
  };

  if (preset) {
    payload.framework = preset;
  }
  if (analysis.buildCommand) {
    payload.buildCommand = analysis.buildCommand;
  }
  if (analysis.outputDirectory) {
    payload.outputDirectory = analysis.outputDirectory;
  }

  // Link GitHub repository if username and repo are provided
  if (username && githubRepoName) {
    payload.gitRepository = {
      type: 'github',
      repo: `${username}/${githubRepoName}`,
    };
  }

  let createRes = await fetch(`${VERCEL_API}/v10/projects${teamQuery}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  // If failed with gitRepository linking (e.g. GitHub app not installed on Vercel), retry without gitRepository
  if (!createRes.ok && payload.gitRepository) {
    delete payload.gitRepository;
    createRes = await fetch(`${VERCEL_API}/v10/projects${teamQuery}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  if (!createRes.ok) {
    const err = await createRes.json();
    throw new Error(`Vercel project creation failed: ${err.error?.message || createRes.statusText}`);
  }

  const data = await createRes.json();
  return { id: data.id, name: data.name };
}

/**
 * Creates a new deployment for a project linked to a GitHub repository or direct files
 */
export async function createVercelDeployment(
  projectName: string,
  githubRepo: string,
  githubBranch = 'main',
  repoId?: number | string,
  files?: ExtractedFile[],
  commitSha?: string,
  analysis?: ProjectAnalysis
): Promise<{
  deploymentId: string;
  url: string;
  readyState: 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';
}> {
  const headers = getHeaders();
  const teamId = CONFIG.VERCEL_TEAM_ID;
  const queryParams = new URLSearchParams({
    skipAutoDetectionConfirmation: '1',
  });
  if (teamId) {
    queryParams.set('teamId', teamId);
  }
  const deploymentQuery = `?${queryParams.toString()}`;
  const username = CONFIG.GITHUB_USERNAME;

  // Derive projectSettings framework if known
  const frameworkMap: Record<string, string | null> = {
    'Next.js': 'nextjs',
    'Vue.js': 'vue',
    'Nuxt.js': 'nuxtjs',
    'Remix': 'remix',
    'Astro': 'astro',
    'SvelteKit': 'sveltekit',
    'React (Vite)': 'vite',
    'Vite Project': 'vite',
    'Vite': 'vite',
    'Angular': 'angular',
    'Static HTML / Web': null,
  };

  const detectedFramework = analysis ? frameworkMap[analysis.framework] : undefined;
  const projectSettings: any = {
    framework: detectedFramework !== undefined ? detectedFramework : null,
  };
  if (analysis?.buildCommand) {
    projectSettings.buildCommand = analysis.buildCommand;
  }
  if (analysis?.outputDirectory) {
    projectSettings.outputDirectory = analysis.outputDirectory;
  }

  // Auto-fetch repoId if not provided
  if (!repoId && githubRepo) {
    try {
      const fetchedId = await getGitHubRepoId(githubRepo);
      if (fetchedId) {
        repoId = fetchedId;
      }
    } catch (e) {
      console.warn(`[VERCEL] Auto-fetch repoId failed for ${githubRepo}:`, e);
    }
  }

  // Helper for Direct File deployment payload
  const deployDirectFiles = async () => {
    if (!files || files.length === 0) {
      throw new Error('No files available for direct deployment.');
    }

    const validFiles = files
      .map((f) => {
        const cleanPath = f.relativePath.replace(/^[\\\/]+/, '');
        if (!cleanPath) return null;
        return {
          file: cleanPath,
          data: f.buffer.toString('base64'),
          encoding: 'base64',
        };
      })
      .filter(Boolean);

    const filePayload = {
      name: projectName,
      project: projectName,
      target: 'production',
      projectSettings,
      files: validFiles,
    };

    const directRes = await fetch(`${VERCEL_API}/v13/deployments${deploymentQuery}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(filePayload),
    });

    if (directRes.ok) {
      const directData = await directRes.json();
      const canonicalUrl = getCanonicalProjectUrl(projectName, undefined, directData.alias);
      return {
        deploymentId: directData.id,
        url: canonicalUrl,
        readyState: directData.readyState || 'BUILDING',
      };
    } else {
      const directErr = await directRes.json();
      const directErrMsg = directErr.error?.message || directRes.statusText;
      throw new Error(`Vercel direct file deployment failed: ${directErrMsg}`);
    }
  };

  // 1. If GitHub repository and username are available, try Git Source deployment first
  if (username && githubRepo) {
    const payload: any = {
      name: projectName,
      project: projectName,
      target: 'production',
      projectSettings,
      gitSource: {
        type: 'github',
        repo: `${username}/${githubRepo}`,
        ref: githubBranch || 'main',
      },
    };

    if (commitSha) {
      payload.gitSource.sha = commitSha;
    }
    if (repoId) {
      payload.gitSource.repoId = String(repoId);
    }

    try {
      let res = await fetch(`${VERCEL_API}/v13/deployments${deploymentQuery}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      // If initial GitHub reference is still syncing on Vercel's side, wait briefly and retry
      if (!res.ok && res.status >= 400 && res.status < 500) {
        const firstErr = await res.json().catch(() => ({}));
        const errMsg = firstErr.error?.message || '';
        if (errMsg.includes('branch or commit reference') || errMsg.includes('empty')) {
          await new Promise((r) => setTimeout(r, 1500));
          res = await fetch(`${VERCEL_API}/v13/deployments${deploymentQuery}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
        }
      }

      if (res.ok) {
        const data = await res.json();
        const canonicalUrl = getCanonicalProjectUrl(projectName, undefined, data.alias);
        return {
          deploymentId: data.id,
          url: canonicalUrl,
          readyState: data.readyState || 'BUILDING',
        };
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn(`[VERCEL] Git source deploy returned: ${err.error?.message || res.statusText}. Continuing with direct file deployment...`);
      }
    } catch (gitErr: any) {
      console.warn(`[VERCEL] Git source deploy exception: ${gitErr?.message}. Continuing with direct file deployment...`);
    }
  }

  // 2. Fallback to direct files deployment
  if (files && files.length > 0) {
    return await deployDirectFiles();
  }

  throw new Error(`Vercel deployment failed: Unable to deploy project via Git or Direct Files.`);
}

/**
 * Fetches latest build error logs from Vercel deployment events
 */
export async function getVercelBuildErrorLogs(deploymentId: string): Promise<string | undefined> {
  const headers = getHeaders();
  const teamQuery = getQueryString();

  try {
    const res = await fetch(`${VERCEL_API}/v2/deployments/${deploymentId}/events${teamQuery}&limit=80`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) return undefined;

    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) return undefined;

    // Filter relevant error, stderr, or warning events
    const errorLogs: string[] = [];
    for (const ev of events) {
      const text = ev.payload?.text || ev.text;
      if (typeof text === 'string') {
        const clean = text.trim();
        if (
          ev.type === 'stderr' ||
          ev.type === 'error' ||
          clean.toLowerCase().includes('error') ||
          clean.toLowerCase().includes('failed') ||
          clean.toLowerCase().includes('command')
        ) {
          errorLogs.push(clean);
        }
      }
    }

    if (errorLogs.length > 0) {
      // Return the most relevant last 4 error lines
      return errorLogs.slice(-4).join('\n');
    }
  } catch (e) {
    console.warn(`Could not fetch Vercel build events for ${deploymentId}:`, e);
  }

  return undefined;
}

/**
 * Polls Vercel deployment status until READY, ERROR, CANCELED, or timeout
 */
export async function pollVercelDeployment(
  deploymentId: string,
  projectName?: string,
  onProgress?: (state: string) => Promise<void>
): Promise<{
  status: 'READY' | 'ERROR' | 'CANCELED' | 'TIMEOUT';
  liveUrl?: string;
  error?: string;
}> {
  const headers = getHeaders();
  const teamQuery = getQueryString();
  const startTime = Date.now();
  const timeout = CONFIG.DEPLOYMENT_TIMEOUT_MS;

  let lastState = '';

  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}${teamQuery}`, {
        method: 'GET',
        headers,
      });

      if (!res.ok) {
        console.warn(`Failed to poll Vercel deployment ${deploymentId}: ${res.statusText}`);
      } else {
        const data = await res.json();
        const state = data.readyState; // INITIALIZING, ANALYZING, BUILDING, READY, ERROR, CANCELED

        if (state !== lastState) {
          lastState = state;
          if (onProgress) {
            await onProgress(state);
          }
        }

        if (state === 'READY') {
          const resolvedName = projectName || data.name || (data.url ? data.url.split('-')[0] : '');
          const liveUrl = getCanonicalProjectUrl(resolvedName, undefined, data.alias);
          return { status: 'READY', liveUrl };
        }

        if (state === 'ERROR') {
          let errorMsg = data.errorMessage || data.error?.message;
          const buildLogs = await getVercelBuildErrorLogs(deploymentId);
          if (buildLogs) {
            errorMsg = errorMsg ? `${errorMsg}\n\n${buildLogs}` : buildLogs;
          }

          return {
            status: 'ERROR',
            error: errorMsg || 'Vercel build failed during compilation.',
          };
        }

        if (state === 'CANCELED') {
          return { status: 'CANCELED', error: 'Deployment was canceled.' };
        }
      }
    } catch (e) {
      console.warn('Vercel polling network warning:', e);
    }

    // Wait 4 seconds between poll cycles
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  return { status: 'TIMEOUT', error: 'Build monitoring timed out after 5 minutes.' };
}

/**
 * Triggers a redeploy for an existing project with GitHub Archive synchronization
 */
export async function redeployVercelProject(
  projectName: string,
  githubRepo: string,
  branch = 'main',
  previousDeploymentId?: string
): Promise<{
  deploymentId: string;
  url: string;
}> {
  // Always fetch latest code directly from GitHub repository archive to ensure all recent edits are built
  try {
    const zipBuffer = await downloadGitHubRepoZip(githubRepo, branch);
    const { analysis, files } = await processAndAnalyzeZip(zipBuffer);
    const repoId = await getGitHubRepoId(githubRepo);

    const directResult = await createVercelDeployment(
      projectName,
      githubRepo,
      branch,
      repoId || undefined,
      files,
      undefined,
      analysis
    );

    return {
      deploymentId: directResult.deploymentId,
      url: directResult.url,
    };
  } catch (syncErr: any) {
    console.warn(`[VERCEL] GitHub archive sync warning: ${syncErr?.message}. Trying fallback redeploy...`);

    // Fallback: Try native redeployment if previousDeploymentId is available
    if (previousDeploymentId) {
      const headers = getHeaders();
      const teamId = CONFIG.VERCEL_TEAM_ID;
      const queryParams = new URLSearchParams({
        deploymentId: previousDeploymentId,
        target: 'production',
        skipAutoDetectionConfirmation: '1',
      });
      if (teamId) {
        queryParams.set('teamId', teamId);
      }

      const res = await fetch(`${VERCEL_API}/v13/deployments?${queryParams.toString()}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: projectName,
          project: projectName,
          target: 'production',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          deploymentId: data.id,
          url: getCanonicalProjectUrl(projectName, undefined, data.alias),
        };
      }
    }

    throw new Error(`Redeployment failed: ${syncErr?.message || 'Could not fetch or deploy project files.'}`);
  }
}

/**
 * Adds a custom domain to a Vercel project
 */
export async function addDomainToVercel(
  projectName: string,
  domain: string
): Promise<{
  success: boolean;
  apexName?: string;
  verification?: any;
  error?: string;
}> {
  const headers = getHeaders();
  const teamQuery = getQueryString();

  const res = await fetch(`${VERCEL_API}/v9/projects/${projectName}/domains${teamQuery}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: domain }),
  });

  if (!res.ok) {
    const err = await res.json();
    return {
      success: false,
      error: err.error?.message || 'Failed to add custom domain to Vercel.',
    };
  }

  const data = await res.json();
  return {
    success: true,
    apexName: data.apexName,
    verification: data.verification,
  };
}

/**
 * Deletes a Vercel project
 */
export async function deleteVercelProject(projectName: string): Promise<boolean> {
  const headers = getHeaders();
  const teamQuery = getQueryString();

  try {
    const res = await fetch(`${VERCEL_API}/v9/projects/${projectName}${teamQuery}`, {
      method: 'DELETE',
      headers,
    });
    return res.status === 200 || res.status === 204 || res.status === 404;
  } catch (e) {
    console.error(`Failed to delete Vercel project ${projectName}:`, e);
    return false;
  }
}

export interface VercelEnvVar {
  id: string;
  key: string;
  value?: string;
  type: 'plain' | 'secret' | 'encrypted' | 'sensitive' | 'system';
  target: ('production' | 'preview' | 'development')[];
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Retrieves environment variables for a Vercel project
 */
export async function getVercelEnvVariables(projectName: string): Promise<VercelEnvVar[]> {
  const headers = getHeaders();
  const teamQuery = getQueryString();

  const res = await fetch(`${VERCEL_API}/v9/projects/${projectName}/env${teamQuery}`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to fetch environment variables: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.envs || [];
}

/**
 * Adds an environment variable to a Vercel project
 */
export async function addVercelEnvVariable(
  projectName: string,
  key: string,
  value: string,
  target: ('production' | 'preview' | 'development')[] = ['production', 'preview', 'development']
): Promise<{ id: string; key: string }> {
  const headers = getHeaders();
  const teamQuery = getQueryString();

  const payload = {
    key: key.trim(),
    value: value.trim(),
    type: 'encrypted',
    target,
  };

  const res = await fetch(`${VERCEL_API}/v10/projects/${projectName}/env${teamQuery}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    // Try array format if single object is rejected
    const fallbackRes = await fetch(`${VERCEL_API}/v10/projects/${projectName}/env${teamQuery}`, {
      method: 'POST',
      headers,
      body: JSON.stringify([payload]),
    });

    if (!fallbackRes.ok) {
      const err = await fallbackRes.json().catch(() => ({}));
      throw new Error(`Failed to add environment variable: ${err.error?.message || res.statusText}`);
    }

    const fbData = await fallbackRes.json();
    const created = fbData.created ? fbData.created[0] : fbData;
    return { id: created.id || created.key, key: created.key || key };
  }

  const data = await res.json().catch(() => ({}));
  const createdItem = (data && Array.isArray(data.created))
    ? data.created[0]
    : (data && data.created)
    ? data.created
    : (data && data.envs && Array.isArray(data.envs))
    ? data.envs[0]
    : data || {};

  const id = createdItem.id || createdItem.key || key;
  const itemKey = createdItem.key || key;
  return { id, key: itemKey };
}

/**
 * Edits an existing environment variable in Vercel project
 */
export async function editVercelEnvVariable(
  projectName: string,
  envId: string,
  value: string,
  target: ('production' | 'preview' | 'development')[] = ['production', 'preview', 'development']
): Promise<boolean> {
  const headers = getHeaders();
  const teamQuery = getQueryString();

  const payload = {
    value: value.trim(),
    target,
  };

  const res = await fetch(`${VERCEL_API}/v9/projects/${projectName}/env/${envId}${teamQuery}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to update environment variable: ${err.error?.message || res.statusText}`);
  }

  return true;
}

/**
 * Deletes an environment variable from Vercel project
 */
export async function deleteVercelEnvVariable(
  projectName: string,
  envId: string
): Promise<boolean> {
  const headers = getHeaders();
  const teamQuery = getQueryString();

  const res = await fetch(`${VERCEL_API}/v9/projects/${projectName}/env/${envId}${teamQuery}`, {
    method: 'DELETE',
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to delete environment variable: ${err.error?.message || res.statusText}`);
  }

  return true;
}

/**
 * Masks sensitive environment variable values for display
 */
export function maskSecretValue(key: string, value?: string): string {
  if (!value) return '••••••••••';
  const lowerKey = key.toLowerCase();
  const isSensitive =
    lowerKey.includes('pass') ||
    lowerKey.includes('secret') ||
    lowerKey.includes('key') ||
    lowerKey.includes('token') ||
    lowerKey.includes('auth') ||
    lowerKey.includes('database') ||
    lowerKey.includes('db_') ||
    lowerKey.includes('private') ||
    lowerKey.includes('cred') ||
    lowerKey.includes('pwd') ||
    lowerKey.includes('salt');

  if (isSensitive) {
    return '••••••••••';
  }

  if (value.length <= 15) {
    return value;
  }

  // If long value, mask middle
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

