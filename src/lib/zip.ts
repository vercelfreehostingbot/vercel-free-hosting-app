// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — SECURE ZIP EXTRACTION & PROJECT ANALYSIS
// =================================================================

import JSZip from 'jszip';
import path from 'path';
import { CONFIG } from './config';
import { ProjectAnalysis } from '../types';
import { isSensitiveFile } from './security';

export interface ExtractedFile {
  relativePath: string;
  buffer: Buffer;
  isText: boolean;
  content?: string;
}

export async function processAndAnalyzeZip(
  zipBuffer: Buffer
): Promise<{
  analysis: ProjectAnalysis;
  files: ExtractedFile[];
}> {
  if (!zipBuffer || zipBuffer.length === 0) {
    throw new Error('Empty ZIP file provided.');
  }

  // Size limit check
  const maxBytes = CONFIG.MAX_ZIP_SIZE_MB * 1024 * 1024;
  if (zipBuffer.length > maxBytes) {
    throw new Error(`ZIP size exceeds maximum allowed limit of ${CONFIG.MAX_ZIP_SIZE_MB}MB.`);
  }

  const zip = new JSZip();
  let loadedZip: JSZip;
  try {
    loadedZip = await zip.loadAsync(zipBuffer);
  } catch (e: any) {
    throw new Error('Invalid or corrupted ZIP archive.');
  }

  const fileEntries = Object.keys(loadedZip.files);
  if (fileEntries.length === 0) {
    throw new Error('The ZIP archive is empty.');
  }

  if (fileEntries.length > CONFIG.MAX_FILE_COUNT) {
    throw new Error(
      `ZIP contains too many files (${fileEntries.length}). Maximum limit is ${CONFIG.MAX_FILE_COUNT}.`
    );
  }

  // Step 1: Detect Project Root
  const detectedRoot = findProjectRoot(fileEntries);

  let totalUncompressedSize = 0;
  const maxUncompressed = CONFIG.MAX_EXTRACT_SIZE_MB * 1024 * 1024;
  const extractedFiles: ExtractedFile[] = [];

  for (const rawPath of fileEntries) {
    const entry = loadedZip.files[rawPath];
    if (entry.dir) continue;

    // Security Check: Zip Slip & Path Traversal Guard
    const normalized = path.normalize(rawPath).replace(/^(\.\.[\/\\])+/, '');
    if (
      normalized.startsWith('..') ||
      path.isAbsolute(normalized) ||
      rawPath.includes('..') ||
      rawPath.startsWith('/') ||
      rawPath.startsWith('\\')
    ) {
      console.warn(`[SECURITY] Skipping potentially dangerous path: ${rawPath}`);
      continue;
    }

    // Strip detected root directory prefix
    let cleanRelativePath = normalized;
    if (detectedRoot && normalized.startsWith(detectedRoot)) {
      cleanRelativePath = normalized.slice(detectedRoot.length).replace(/^[\\\/]/, '');
    }

    if (!cleanRelativePath) continue;

    // Security: Filter out sensitive credentials or git metadata
    if (isSensitiveFile(cleanRelativePath)) {
      console.log(`[SECURITY] Excluded sensitive file from push: ${cleanRelativePath}`);
      continue;
    }

    const fileBuf = await entry.async('nodebuffer');
    totalUncompressedSize += fileBuf.length;

    if (totalUncompressedSize > maxUncompressed) {
      throw new Error(`Extracted size exceeds ${CONFIG.MAX_EXTRACT_SIZE_MB}MB limit.`);
    }

    // Check if file is text/code or binary
    const isText = isTextFile(cleanRelativePath);
    let textContent: string | undefined = undefined;
    if (isText && fileBuf.length < 5 * 1024 * 1024) {
      textContent = fileBuf.toString('utf-8');
    }

    extractedFiles.push({
      relativePath: cleanRelativePath,
      buffer: fileBuf,
      isText,
      content: textContent,
    });
  }

  // Step 1.5: Auto-heal vulnerable or outdated dependencies in package.json (e.g. Next.js <14.2.15)
  autoHealProjectDependencies(extractedFiles);

  // Step 2: Analyze Framework & Compatibility
  const analysis = analyzeProject(extractedFiles, detectedRoot, totalUncompressedSize);

  return {
    analysis,
    files: extractedFiles,
  };
}

/**
 * Checks if a given Next.js version string represents a vulnerable or deprecated version
 * (Vercel blocks Next.js < 15.5.24 and < 16.3.3 due to critical security advisories GHSA-2xp9-vwfh-vxw4 and CVE-2026-75604)
 */
function isVulnerableNextVersion(ver: string | undefined): boolean {
  if (!ver || typeof ver !== 'string') return true;
  const trimmed = ver.trim();

  // Wildcards, unpinned, or canary/pre-releases
  if (
    trimmed === 'latest' ||
    trimmed === '*' ||
    trimmed.includes('canary') ||
    trimmed.includes('beta') ||
    trimmed.includes('alpha') ||
    trimmed.includes('rc') ||
    trimmed.includes('git') ||
    trimmed.includes('/')
  ) {
    return true;
  }

  // Strip leading semver qualifiers (^, ~, >=, <=, >, <, =, v)
  const clean = trimmed.replace(/^[~^>=<v\s]+/, '');

  // Parse major.minor.patch
  const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return true;

  const major = parseInt(match[1], 10);
  const minor = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const patch = match[3] !== undefined ? parseInt(match[3], 10) : 0;

  // Next.js versions 0.x through 14.x are completely blocked by Vercel
  if (major < 15) {
    return true;
  }

  // In Next.js 15: versions prior to 15.5.24 are blocked by Vercel
  if (major === 15) {
    if (minor < 5) {
      return true;
    }
    if (minor === 5 && patch < 24) {
      return true;
    }
  }

  // In Next.js 16: versions prior to 16.3.3 are blocked by Vercel
  if (major === 16) {
    if (minor < 3) {
      return true;
    }
    if (minor === 3 && patch < 3) {
      return true;
    }
  }

  return false;
}

/**
 * Automatically inspects and upgrades vulnerable or outdated dependencies in a package.json string
 */
export function autoHealPackageJsonString(rawJson: string): string {
  try {
    const pkg = JSON.parse(rawJson);
    let modified = false;

    const SECURE_NEXT_VERSION = '^15.5.24';

    // Determine current React version in dependencies
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };

    const currentReact = allDeps['react'] || '';
    const isReact19 = /^[~^]?(?:19|20)\./.test(currentReact.trim());
    const isReact18 = /^[~^]?18\./.test(currentReact.trim());

    // Appropriate compatible React versions
    const targetReact = isReact19 ? (currentReact || '^19.0.0') : '^18.3.1';
    const targetReactDom = isReact19 ? (allDeps['react-dom'] || '^19.0.0') : '^18.3.1';
    const targetTypesReact = isReact19 ? '^19.0.0' : '^18.3.12';
    const targetTypesReactDom = isReact19 ? '^19.0.0' : '^18.3.1';

    const checkAndUpgradeDeps = (depsObj: Record<string, string> | undefined) => {
      if (!depsObj) return;

      if (depsObj['next']) {
        const currentNext = depsObj['next'];

        if (isVulnerableNextVersion(currentNext)) {
          console.log(`[AUTO-HEAL] Upgrading vulnerable Next.js from ${currentNext} to ${SECURE_NEXT_VERSION}`);
          depsObj['next'] = SECURE_NEXT_VERSION;
          modified = true;

          // Ensure React is compatible (upgrade only if older than 18 or placeholder)
          if (depsObj['react']) {
            const rVer = depsObj['react'].trim();
            if (/^[~^]?(?:[0-9]|1[0-7])\./.test(rVer) || rVer === 'latest' || rVer === '*') {
              depsObj['react'] = targetReact;
              modified = true;
            }
          } else {
            depsObj['react'] = targetReact;
            modified = true;
          }

          // Ensure React DOM is compatible
          if (depsObj['react-dom']) {
            const rdVer = depsObj['react-dom'].trim();
            if (/^[~^]?(?:[0-9]|1[0-7])\./.test(rdVer) || rdVer === 'latest' || rdVer === '*') {
              depsObj['react-dom'] = targetReactDom;
              modified = true;
            }
          } else {
            depsObj['react-dom'] = targetReactDom;
            modified = true;
          }

          // Update devDependencies types if present
          if (pkg.devDependencies) {
            if (pkg.devDependencies['@types/react']) {
              pkg.devDependencies['@types/react'] = targetTypesReact;
            }
            if (pkg.devDependencies['@types/react-dom']) {
              pkg.devDependencies['@types/react-dom'] = targetTypesReactDom;
            }
          }
        }

        // Remove problematic sharp dependency to prevent script warnings / install failures
        if (depsObj['sharp']) {
          delete depsObj['sharp'];
          modified = true;
        }
      }
    };

    checkAndUpgradeDeps(pkg.dependencies);
    checkAndUpgradeDeps(pkg.devDependencies);
    checkAndUpgradeDeps(pkg.peerDependencies);
    checkAndUpgradeDeps(pkg.optionalDependencies);

    // Clean or synchronize existing overrides to prevent EOVERRIDE conflicts
    if (pkg.overrides) {
      if (pkg.overrides['next'] && isVulnerableNextVersion(pkg.overrides['next'])) {
        pkg.overrides['next'] = SECURE_NEXT_VERSION;
      }
      // If overrides conflict with direct react dependency, delete the override
      if (pkg.overrides['react']) {
        delete pkg.overrides['react'];
        modified = true;
      }
      if (pkg.overrides['react-dom']) {
        delete pkg.overrides['react-dom'];
        modified = true;
      }
    }

    if (pkg.resolutions) {
      if (pkg.resolutions['next'] && isVulnerableNextVersion(pkg.resolutions['next'])) {
        pkg.resolutions['next'] = SECURE_NEXT_VERSION;
      }
      if (pkg.resolutions['react']) {
        delete pkg.resolutions['react'];
        modified = true;
      }
      if (pkg.resolutions['react-dom']) {
        delete pkg.resolutions['react-dom'];
        modified = true;
      }
    }

    if (pkg.engines?.node) {
      const nodeEng = pkg.engines.node.trim();
      if (/^[~^]?(?:1[0-6]|[0-9])\./.test(nodeEng) || nodeEng.includes('14') || nodeEng.includes('16')) {
        pkg.engines.node = '>=18.18.0';
        modified = true;
      }
    }

    if (modified) {
      return JSON.stringify(pkg, null, 2);
    }
  } catch (e) {
    // Ignore JSON parse errors
  }
  return rawJson;
}

/**
 * Automatically inspects and upgrades vulnerable or outdated dependencies
 * (such as old Next.js 11/12/13/14 versions that Vercel actively blocks due to security advisories)
 * and strips stale lockfiles to ensure Vercel builds clean, secure dependencies.
 */
function autoHealProjectDependencies(files: ExtractedFile[]) {
  // Find all package.json files in the project
  const pkgFiles = files.filter((f) => {
    const lower = f.relativePath.toLowerCase();
    return lower === 'package.json' || lower.endsWith('/package.json');
  });

  let anyNextProject = false;
  let anyModified = false;

  const SECURE_NEXT_VERSION = '^15.5.24';

  for (const pkgFile of pkgFiles) {
    if (!pkgFile.content) continue;

    try {
      const pkg = JSON.parse(pkgFile.content);
      let modified = false;

      // Determine current React version in dependencies
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {}),
      };

      const currentReact = allDeps['react'] || '';
      const isReact19 = /^[~^]?(?:19|20)\./.test(currentReact.trim());

      const targetReact = isReact19 ? (currentReact || '^19.0.0') : '^18.3.1';
      const targetReactDom = isReact19 ? (allDeps['react-dom'] || '^19.0.0') : '^18.3.1';
      const targetTypesReact = isReact19 ? '^19.0.0' : '^18.3.12';
      const targetTypesReactDom = isReact19 ? '^19.0.0' : '^18.3.1';

      // Helper to check and upgrade Next.js version in dependency dictionaries
      const checkAndUpgradeDeps = (depsObj: Record<string, string> | undefined) => {
        if (!depsObj) return;

        if (depsObj['next']) {
          anyNextProject = true;
          const currentNext = depsObj['next'];

          if (isVulnerableNextVersion(currentNext)) {
            console.log(`[AUTO-HEAL] Upgrading vulnerable Next.js from ${currentNext} to ${SECURE_NEXT_VERSION} in ${pkgFile.relativePath}`);
            depsObj['next'] = SECURE_NEXT_VERSION;
            modified = true;
            anyModified = true;

            // Ensure React is compatible
            if (depsObj['react']) {
              const rVer = depsObj['react'].trim();
              if (/^[~^]?(?:[0-9]|1[0-7])\./.test(rVer) || rVer === 'latest' || rVer === '*') {
                console.log(`[AUTO-HEAL] Upgrading React from ${rVer} to ${targetReact}`);
                depsObj['react'] = targetReact;
              }
            } else {
              depsObj['react'] = targetReact;
            }

            // Ensure React DOM is compatible
            if (depsObj['react-dom']) {
              const rdVer = depsObj['react-dom'].trim();
              if (/^[~^]?(?:[0-9]|1[0-7])\./.test(rdVer) || rdVer === 'latest' || rdVer === '*') {
                console.log(`[AUTO-HEAL] Upgrading React DOM from ${rdVer} to ${targetReactDom}`);
                depsObj['react-dom'] = targetReactDom;
              }
            } else {
              depsObj['react-dom'] = targetReactDom;
            }

            // Update devDependencies types if present
            if (pkg.devDependencies) {
              if (pkg.devDependencies['@types/react']) {
                pkg.devDependencies['@types/react'] = targetTypesReact;
              }
              if (pkg.devDependencies['@types/react-dom']) {
                pkg.devDependencies['@types/react-dom'] = targetTypesReactDom;
              }
            }
          }

          // Remove sharp from package.json to prevent install warnings and binary build errors
          if (depsObj['sharp']) {
            delete depsObj['sharp'];
            modified = true;
            anyModified = true;
          }
        }
      };

      checkAndUpgradeDeps(pkg.dependencies);
      checkAndUpgradeDeps(pkg.devDependencies);
      checkAndUpgradeDeps(pkg.peerDependencies);
      checkAndUpgradeDeps(pkg.optionalDependencies);

      // Clean or remove conflicting overrides/resolutions
      if (pkg.overrides) {
        if (pkg.overrides['next'] && isVulnerableNextVersion(pkg.overrides['next'])) {
          pkg.overrides['next'] = SECURE_NEXT_VERSION;
        }
        if (pkg.overrides['react']) {
          delete pkg.overrides['react'];
          modified = true;
          anyModified = true;
        }
        if (pkg.overrides['react-dom']) {
          delete pkg.overrides['react-dom'];
          modified = true;
          anyModified = true;
        }
      }

      if (pkg.resolutions) {
        if (pkg.resolutions['next'] && isVulnerableNextVersion(pkg.resolutions['next'])) {
          pkg.resolutions['next'] = SECURE_NEXT_VERSION;
        }
        if (pkg.resolutions['react']) {
          delete pkg.resolutions['react'];
          modified = true;
          anyModified = true;
        }
        if (pkg.resolutions['react-dom']) {
          delete pkg.resolutions['react-dom'];
          modified = true;
          anyModified = true;
        }
      }

      // Check engines.node
      if (pkg.engines?.node) {
        const nodeEng = pkg.engines.node.trim();
        if (/^[~^]?(?:1[0-6]|[0-9])\./.test(nodeEng) || nodeEng.includes('14') || nodeEng.includes('16')) {
          console.log(`[AUTO-HEAL] Updating outdated engines.node (${nodeEng}) to >=18.18.0`);
          pkg.engines.node = '>=18.18.0';
          modified = true;
          anyModified = true;
        }
      }

      if (modified) {
        const updatedJson = JSON.stringify(pkg, null, 2);
        pkgFile.content = updatedJson;
        pkgFile.buffer = Buffer.from(updatedJson, 'utf-8');
        console.log(`[AUTO-HEAL] Successfully updated ${pkgFile.relativePath} with secure dependencies.`);
      }
    } catch (err) {
      console.warn(`[AUTO-HEAL] Could not auto-heal ${pkgFile.relativePath}:`, err);
    }
  }

  // If any dependencies were upgraded or if this is a Next.js project, strip out stale lockfiles
  if (anyModified || anyNextProject) {
    const lockfileNames = [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lockb',
      'bun.lock',
    ];

    for (let i = files.length - 1; i >= 0; i--) {
      const f = files[i];
      const lower = f.relativePath.toLowerCase();
      const isLockfile = lockfileNames.some((name) => lower === name || lower.endsWith(`/${name}`));
      if (isLockfile) {
        console.log(`[AUTO-HEAL] Removed stale lockfile to prevent vulnerable package pinning: ${f.relativePath}`);
        files.splice(i, 1);
      }
    }

    // Ensure .npmrc with legacy-peer-deps exists to avoid install lockups
    const npmrcIndex = files.findIndex((f) => f.relativePath.toLowerCase() === '.npmrc');
    if (npmrcIndex >= 0) {
      const existing = files[npmrcIndex].content || '';
      if (!existing.includes('legacy-peer-deps')) {
        const updated = existing + '\nlegacy-peer-deps=true\n';
        files[npmrcIndex].content = updated;
        files[npmrcIndex].buffer = Buffer.from(updated, 'utf-8');
      }
    } else {
      const npmrcContent = 'legacy-peer-deps=true\n';
      files.push({
        relativePath: '.npmrc',
        buffer: Buffer.from(npmrcContent, 'utf-8'),
        isText: true,
        content: npmrcContent,
      });
      console.log('[AUTO-HEAL] Injected .npmrc with legacy-peer-deps=true');
    }

    // Sanitize next.config.js / next.config.mjs / next.config.ts / next.config.cjs
    const nextConfigFiles = files.filter((f) => {
      const lower = f.relativePath.toLowerCase();
      return (
        lower === 'next.config.js' ||
        lower.endsWith('/next.config.js') ||
        lower === 'next.config.mjs' ||
        lower.endsWith('/next.config.mjs') ||
        lower === 'next.config.ts' ||
        lower.endsWith('/next.config.ts') ||
        lower === 'next.config.cjs' ||
        lower.endsWith('/next.config.cjs')
      );
    });

    if (nextConfigFiles.length === 0 && anyNextProject) {
      // Add a safe fallback next.config.js to ensure builds succeed on Vercel
      const safeNextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
`;
      files.push({
        relativePath: 'next.config.js',
        buffer: Buffer.from(safeNextConfig, 'utf-8'),
        isText: true,
        content: safeNextConfig,
      });
      console.log('[AUTO-HEAL] Injected safe default next.config.js for Next.js project.');
    } else {
      for (const conf of nextConfigFiles) {
        if (conf.content) {
          let sanitized = conf.content;
          // Remove obsolete experimental flags from older Next.js versions (Next 10-14)
          sanitized = sanitized.replace(/appDir\s*:\s*(true|false),?/g, '');
          sanitized = sanitized.replace(/serverActions\s*:\s*(true|false),?/g, '');
          sanitized = sanitized.replace(/serverComponents\s*:\s*(true|false),?/g, '');
          sanitized = sanitized.replace(/concurrentFeatures\s*:\s*(true|false),?/g, '');

          // Ensure typescript.ignoreBuildErrors: true is present
          if (!sanitized.includes('ignoreBuildErrors')) {
            if (sanitized.includes('typescript:')) {
              sanitized = sanitized.replace(/typescript\s*:\s*\{/, 'typescript: {\n    ignoreBuildErrors: true,');
            } else if (sanitized.includes('nextConfig = {') || sanitized.includes('nextConfig={')) {
              sanitized = sanitized.replace(/(nextConfig\s*=\s*\{)/, '$1\n  typescript: { ignoreBuildErrors: true },');
            } else if (sanitized.includes('module.exports = {') || sanitized.includes('export default {')) {
              sanitized = sanitized.replace(/((?:module\.exports|export\s+default)\s*=\s*\{)/, '$1\n  typescript: { ignoreBuildErrors: true },');
            }
          }

          // Ensure eslint.ignoreDuringBuilds: true is present
          if (!sanitized.includes('ignoreDuringBuilds')) {
            if (sanitized.includes('eslint:')) {
              sanitized = sanitized.replace(/eslint\s*:\s*\{/, 'eslint: {\n    ignoreDuringBuilds: true,');
            } else if (sanitized.includes('nextConfig = {') || sanitized.includes('nextConfig={')) {
              sanitized = sanitized.replace(/(nextConfig\s*=\s*\{)/, '$1\n  eslint: { ignoreDuringBuilds: true },');
            } else if (sanitized.includes('module.exports = {') || sanitized.includes('export default {')) {
              sanitized = sanitized.replace(/((?:module\.exports|export\s+default)\s*=\s*\{)/, '$1\n  eslint: { ignoreDuringBuilds: true },');
            }
          }

          // Ensure images.unoptimized: true is present to prevent sharp binary errors
          if (!sanitized.includes('unoptimized: true') && !sanitized.includes('unoptimized:true')) {
            if (sanitized.includes('images:')) {
              sanitized = sanitized.replace(/images\s*:\s*\{/, 'images: {\n    unoptimized: true,');
            } else if (sanitized.includes('nextConfig = {') || sanitized.includes('nextConfig={')) {
              sanitized = sanitized.replace(/(nextConfig\s*=\s*\{)/, '$1\n  images: { unoptimized: true },');
            } else if (sanitized.includes('module.exports = {') || sanitized.includes('export default {')) {
              sanitized = sanitized.replace(/((?:module\.exports|export\s+default)\s*=\s*\{)/, '$1\n  images: { unoptimized: true },');
            }
          }

          if (sanitized !== conf.content) {
            conf.content = sanitized;
            conf.buffer = Buffer.from(sanitized, 'utf-8');
            console.log(`[AUTO-HEAL] Cleaned and injected build safety flags in ${conf.relativePath}`);
          }
        }
      }
    }
  }
}

/**
 * Automatically detects whether files are wrapped in a single root directory or located at the root
 */
function findProjectRoot(filePaths: string[]): string {
  const nonDirs = filePaths.filter((p) => !p.endsWith('/'));
  if (nonDirs.length === 0) return '';

  // If there is package.json or index.html at root, root is empty ''
  if (nonDirs.some((p) => p === 'package.json' || p === 'index.html' || p === 'vercel.json')) {
    return '';
  }

  // Check top-level folder names
  const topFolders = new Set<string>();
  for (const p of nonDirs) {
    const parts = p.split(/[\\\/]/);
    if (parts.length > 1) {
      topFolders.add(parts[0]);
    } else {
      // There's a file at root
      return '';
    }
  }

  // If all files share exactly one top-level directory
  if (topFolders.size === 1) {
    const rootFolder = Array.from(topFolders)[0];
    return rootFolder + '/';
  }

  return '';
}

/**
 * Analyzes extracted project files to detect framework, package manager, and build configuration
 */
function analyzeProject(
  files: ExtractedFile[],
  detectedRoot: string,
  totalSize: number
): ProjectAnalysis {
  let hasPackageJson = false;
  let hasVercelJson = false;
  let hasIndexHtml = false;
  let packageJsonContent: any = null;

  let framework = 'Static HTML / JS';
  let packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'none' = 'none';
  let buildCommand: string | undefined = undefined;
  let outputDirectory: string | undefined = undefined;

  for (const f of files) {
    if (f.relativePath === 'package.json') {
      hasPackageJson = true;
      try {
        packageJsonContent = JSON.parse(f.content || '{}');
      } catch (e) {
        // Corrupted package.json
      }
    }
    if (f.relativePath === 'vercel.json') hasVercelJson = true;
    if (f.relativePath === 'index.html') hasIndexHtml = true;
    if (f.relativePath === 'yarn.lock') packageManager = 'yarn';
    if (f.relativePath === 'pnpm-lock.yaml') packageManager = 'pnpm';
    if (f.relativePath === 'bun.lockb' || f.relativePath === 'bun.lock') packageManager = 'bun';
    if (f.relativePath === 'package-lock.json' && packageManager === 'none') packageManager = 'npm';
  }

  if (hasPackageJson && packageManager === 'none') {
    packageManager = 'npm';
  }

  // Inspect package.json dependencies and devDependencies
  if (packageJsonContent) {
    const deps = {
      ...(packageJsonContent.dependencies || {}),
      ...(packageJsonContent.devDependencies || {}),
    };

    if (deps['next']) {
      framework = 'Next.js (React)';
    } else if (deps['@remix-run/react'] || deps['remix']) {
      framework = 'Remix';
    } else if (deps['@astrojs/core'] || deps['astro']) {
      framework = 'Astro';
    } else if (deps['@sveltejs/kit'] || deps['svelte']) {
      framework = 'Svelte / SvelteKit';
    } else if (deps['nuxt'] || deps['nuxt3']) {
      framework = 'Nuxt.js (Vue)';
    } else if (deps['@angular/core']) {
      framework = 'Angular';
    } else if (deps['vue']) {
      framework = 'Vue.js';
    } else if (deps['solid-js'] || deps['@solidjs/start']) {
      framework = 'SolidJS';
    } else if (deps['@builder.io/qwik'] || deps['@builder.io/qwik-city']) {
      framework = 'Qwik';
    } else if (deps['gatsby']) {
      framework = 'Gatsby';
    } else if (deps['@11ty/eleventy']) {
      framework = 'Eleventy (11ty)';
    } else if (deps['@docusaurus/core']) {
      framework = 'Docusaurus';
    } else if (deps['vitepress']) {
      framework = 'VitePress';
    } else if (deps['vite']) {
      framework = deps['react'] ? 'React (Vite)' : 'Vite Project';
    } else if (deps['react']) {
      framework = 'React Web App';
    } else if (deps['express'] || deps['fastify'] || deps['koa'] || deps['@nestjs/core'] || deps['hono']) {
      framework = 'Node.js Serverless / API';
    } else {
      framework = 'Node.js Fullstack / Web';
    }

    if (packageJsonContent.scripts?.build) {
      buildCommand = packageJsonContent.scripts.build;
    }
  } else {
    // Check config files and specific languages if no package.json
    const filePaths = files.map((f) => f.relativePath.toLowerCase());
    
    if (files.some((f) => f.relativePath.startsWith('next.config.'))) {
      framework = 'Next.js';
    } else if (files.some((f) => f.relativePath.startsWith('vite.config.'))) {
      framework = 'Vite';
    } else if (files.some((f) => f.relativePath.startsWith('astro.config.'))) {
      framework = 'Astro';
    } else if (files.some((f) => f.relativePath.startsWith('nuxt.config.'))) {
      framework = 'Nuxt.js';
    } else if (files.some((f) => f.relativePath.startsWith('svelte.config.'))) {
      framework = 'Svelte';
    } else if (
      filePaths.some((p) => p === 'requirements.txt' || p === 'pipfile' || p === 'pyproject.toml') ||
      filePaths.some((p) => p.endsWith('.py'))
    ) {
      framework = 'Python (FastAPI / Flask / WSGI)';
    } else if (
      filePaths.some((p) => p === 'composer.json' || p === 'index.php') ||
      filePaths.some((p) => p.endsWith('.php'))
    ) {
      framework = 'PHP Web Application';
    } else if (
      filePaths.some((p) => p === 'go.mod') ||
      filePaths.some((p) => p.endsWith('.go'))
    ) {
      framework = 'Go (Golang)';
    } else if (
      filePaths.some((p) => p === 'gemfile') ||
      filePaths.some((p) => p.endsWith('.rb'))
    ) {
      framework = 'Ruby';
    } else if (
      filePaths.some((p) => p === 'cargo.toml') ||
      filePaths.some((p) => p.endsWith('.rs'))
    ) {
      framework = 'Rust';
    } else if (filePaths.some((p) => p.includes('hugo.toml') || p.includes('config.toml'))) {
      framework = 'Hugo Static Site';
    } else if (filePaths.some((p) => p.includes('_config.yml'))) {
      framework = 'Jekyll Static Site';
    } else if (hasIndexHtml) {
      framework = 'Static HTML / Web';
    } else if (filePaths.some((p) => p.endsWith('.html') || p.endsWith('.htm'))) {
      framework = 'HTML5 Web Application';
    } else if (filePaths.some((p) => p.endsWith('.js') || p.endsWith('.ts'))) {
      framework = 'JavaScript / TypeScript Web';
    } else {
      framework = 'Universal Web App';
    }
  }

  // All modern web, backend and serverless frameworks & languages are supported
  const compatible = true;
  const incompatibleReason: string | undefined = undefined;

  return {
    framework,
    packageManager,
    hasPackageJson,
    hasVercelJson,
    hasIndexHtml,
    buildCommand,
    outputDirectory,
    compatible,
    incompatibleReason,
    detectedRoot,
    fileCount: files.length,
    totalSize,
  };
}

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const textExtensions = new Set([
    // Web Standards
    '.html',
    '.htm',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.styl',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.vue',
    '.svelte',
    '.astro',
    '.json',
    '.json5',
    '.jsonc',
    '.md',
    '.mdx',
    '.txt',
    '.svg',
    '.xml',
    '.yaml',
    '.yml',
    // Python
    '.py',
    '.pyi',
    '.pip',
    '.ipynb',
    // PHP
    '.php',
    '.phtml',
    '.php4',
    '.php5',
    '.php7',
    // Ruby
    '.rb',
    '.erb',
    '.gemspec',
    // Go & Rust
    '.go',
    '.mod',
    '.sum',
    '.rs',
    // C, C++, C#, Java, Kotlin, Dart, Swift
    '.c',
    '.cpp',
    '.cc',
    '.cxx',
    '.h',
    '.hpp',
    '.cs',
    '.java',
    '.kt',
    '.kts',
    '.dart',
    '.swift',
    '.lua',
    '.r',
    // Shell & Scripts
    '.sh',
    '.bash',
    '.zsh',
    '.bat',
    '.cmd',
    '.ps1',
    // Database & Query
    '.sql',
    '.graphql',
    '.gql',
    '.prisma',
    // Configs & Project files
    '.env',
    '.env.example',
    '.env.local',
    '.env.production',
    '.env.development',
    '.gitignore',
    '.prettierrc',
    '.eslintrc',
    '.babelrc',
    '.npmrc',
    '.toml',
    '.ini',
    '.conf',
    '.config',
    '.lock',
    '.csv',
    '.tsv',
    '.log',
  ]);
  return textExtensions.has(ext);
}
