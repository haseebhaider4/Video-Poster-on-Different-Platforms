import crypto from 'node:crypto';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a JSON response, throwing a readable error if the request failed. */
export async function readJson(res, label) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const e = body.error;
    const msg =
      (e && typeof e === 'object' && (e.error_user_msg || e.message || e.code)) ||
      body.error_description ||
      (typeof e === 'string' ? e : null) ||
      (body.raw && body.raw.slice(0, 300)) ||
      res.statusText;
    throw new Error(`${label}: ${msg} (HTTP ${res.status})`);
  }
  return body;
}

export function parseTags(input) {
  return [...new Set(
    String(input || '')
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#+/, '').trim())
      .filter(Boolean),
  )];
}

/** Title + description + hashtags as one caption, for platforms that have no separate title. */
export function buildCaption(post, max, { includeTitle = true } = {}) {
  const parts = [
    includeTitle ? post.title : '',
    post.description,
    post.hashtags.map((t) => `#${t}`).join(' '),
  ]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  return [...new Set(parts)].join('\n\n').slice(0, max);
}

// Temporary public links to an uploaded file, used only for Instagram's fallback upload method.
const shared = new Map();
export const media = {
  share(file, publicUrl) {
    const key = crypto.randomBytes(18).toString('hex');
    shared.set(key, file);
    return { key, url: `${publicUrl}/media/${key}` };
  },
  lookup: (key) => shared.get(key),
  unshare: (key) => shared.delete(key),
};
