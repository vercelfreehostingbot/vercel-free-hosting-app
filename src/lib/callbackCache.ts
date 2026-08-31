// =================================================================
// 𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧 — TELEGRAM CALLBACK DATA SHORTENER CACHE
// =================================================================
// Telegram inline keyboard callback_data has a strict limit of 64 bytes.
// When dealing with long project IDs and nested file paths (e.g.
// proj:file_edit:proj_17248...:pages/dashboard/analytics.html),
// callback_data exceeds 64 bytes, causing Telegram API error 400.
// This module provides a fast, persistent shortener that seamlessly
// encodes and decodes callback queries.
// =================================================================

import crypto from 'crypto';

interface CachedCallback {
  data: string;
  createdAt: number;
}

// In-memory LRU-like store (fastest)
const memoryCache = new Map<string, CachedCallback>();
const MAX_CACHE_SIZE = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function cleanupOldEntries() {
  const now = Date.now();
  if (memoryCache.size > MAX_CACHE_SIZE) {
    for (const [key, val] of memoryCache.entries()) {
      if (now - val.createdAt > CACHE_TTL_MS || memoryCache.size > MAX_CACHE_SIZE - 500) {
        memoryCache.delete(key);
      }
    }
  }
}

/**
 * Encodes a callback_data string. If length > 55 bytes, returns a shortened token 'cb:<hash>'.
 */
export function encodeCallbackData(data: string): string {
  if (!data || Buffer.byteLength(data, 'utf-8') <= 55) {
    return data;
  }

  // Generate an 8-character deterministic or unique hash
  const hash = crypto.createHash('sha256').update(data).digest('base64url').slice(0, 8);
  const key = `cb:${hash}`;

  cleanupOldEntries();
  memoryCache.set(key, {
    data,
    createdAt: Date.now(),
  });

  return key;
}

/**
 * Decodes a callback_data string. If it starts with 'cb:', resolves to the full string.
 */
export function decodeCallbackData(data: string): string {
  if (!data) return '';
  if (!data.startsWith('cb:')) {
    return data;
  }

  const cached = memoryCache.get(data);
  if (cached) {
    return cached.data;
  }

  return data;
}

/**
 * Helper to build safe inline keyboard buttons with automatic callback_data shortening
 */
export function createSafeButton(text: string, callbackData: string): { text: string; callback_data: string } {
  return {
    text,
    callback_data: encodeCallbackData(callbackData),
  };
}
