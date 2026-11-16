import fs from 'node:fs';
import { cfg, PUBLIC_URL } from '../config.js';
import { accounts } from '../store.js';
import { readJson, buildCaption, sleep } from '../util.js';

const API = 'https://open.tiktokapis.com';
const MB = 1024 * 1024;
const redirectUri = () => `${PUBLIC_URL}/auth/tiktok/callback`;

export function setupIssue() {
  if (!cfg.tiktok.clientKey || !cfg.tiktok.clientSecret) {
    return 'Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to .env, then restart (see README).';
  }
  if (!PUBLIC_URL.startsWith('https://')) {
    return 'TikTok only accepts https sign-in links. Set PUBLIC_URL in .env to your ngrok / Cloudflare tunnel address (see README).';
  }
  return null;
}

export function authUrl(state) {
  const p = new URLSearchParams({
    client_key: cfg.tiktok.clientKey,
    scope: 'user.info.basic,video.publish',
    response_type: 'code',
    redirect_uri: redirectUri(),
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
}

/** TikTok wraps API answers as { data, error: { code: 'ok' | ..., message } }. */
async function tt(res, label) {
  const body = await readJson(res, label);
  if (body.error && body.error.code && body.error.code !== 'ok') {
    throw new Error(`${label}: ${body.error.message || body.error.code}`);
  }
  return body.data || {};
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({
      client_key: cfg.tiktok.clientKey,
      client_secret: cfg.tiktok.clientSecret,
      ...params,
    }),
  });
  const t = await readJson(res, 'TikTok sign-in');
  if (!t.access_token) {
    throw new Error(`TikTok sign-in: ${t.error_description || t.error || 'no access token returned'}`);
  }
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in || 86400) * 1000,
    open_id: t.open_id,
  };
}

export async function handleCallback(code) {
  const tokens = await tokenRequest({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  });
  let user = {};
  try {
    const res = await fetch(`${API}/v2/user/info/?fields=open_id,avatar_url,display_name`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    user = (await tt(res, 'TikTok')).user || {};
  } catch (err) {
    console.warn('Could not read TikTok profile:', err.message);
  }
  accounts.upsert({
    platform: 'tiktok',
    externalId: tokens.open_id,
    name: user.display_name || 'TikTok account',
    avatar: user.avatar_url || null,
    tokens,
  });
  return 1;
}

async function accessToken(acc) {
  const t = acc.tokens;
  if (t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
  if (!t.refresh_token) throw new Error('Sign-in expired. Disconnect and reconnect this account.');
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  accounts.update(acc.id, { tokens: { ...t, ...fresh } });
  return fresh.access_token;
}

export async function publish(acc, file, post, progress) {
  const token = await accessToken(acc);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' };

  progress('Checking account settings');
  const info = await tt(
    await fetch(`${API}/v2/post/publish/creator_info/query/`, { method: 'POST', headers }),
    'TikTok',
  );
  const options = info.privacy_level_options || [];
  let privacy = post.tiktokPrivacy;
  let note = '';
  if (options.length && !options.includes(privacy)) {
    privacy = options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
    note = `TikTok only allows "${privacy}" for this app right now, so it was posted that way.`;
  }

  // TikTok wants chunks between 5 MB and 64 MB; the last chunk takes the remainder.
  const size = file.size;
  const chunkSize = size <= 64 * MB ? size : 10 * MB;
  const chunkCount = size <= 64 * MB ? 1 : Math.floor(size / chunkSize);

  progress('Starting upload');
  const init = await tt(
    await fetch(`${API}/v2/post/publish/video/init/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        post_info: {
          title: buildCaption(post, 2200),
          privacy_level: privacy,
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: size,
          chunk_size: chunkSize,
          total_chunk_count: chunkCount,
        },
      }),
    }),
    'TikTok',
  );

  const blob = await fs.openAsBlob(file.path);
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = i === chunkCount - 1 ? size : start + chunkSize;
    progress(chunkCount > 1 ? `Uploading part ${i + 1} of ${chunkCount}` : 'Uploading video');
    const res = await fetch(init.upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': file.mimetype,
        'Content-Range': `bytes ${start}-${end - 1}/${size}`,
      },
      body: blob.slice(start, end),
    });
    if (!res.ok) await readJson(res, 'TikTok upload');
  }

  progress('TikTok is processing the video');
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const s = await tt(
      await fetch(`${API}/v2/post/publish/status/fetch/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ publish_id: init.publish_id }),
      }),
      'TikTok',
    );
    if (s.status === 'PUBLISH_COMPLETE') return { id: init.publish_id, url: null, note: note || 'Posted' };
    if (s.status === 'FAILED') throw new Error(`TikTok rejected the video: ${s.fail_reason || 'unknown reason'}`);
  }
  return { id: init.publish_id, url: null, note: 'Uploaded. TikTok is still processing it; check the app in a few minutes.' };
}
