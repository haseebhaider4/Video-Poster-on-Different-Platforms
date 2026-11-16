import fs from 'node:fs';
import { cfg, LOCAL_URL } from '../config.js';
import { accounts } from '../store.js';
import { readJson } from '../util.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const redirectUri = () => `${LOCAL_URL}/auth/youtube/callback`;

export function setupIssue() {
  if (!cfg.youtube.clientId || !cfg.youtube.clientSecret) {
    return 'Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env, then restart (see README).';
  }
  return null;
}

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: cfg.youtube.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.youtube.clientId,
      client_secret: cfg.youtube.clientSecret,
      ...params,
    }),
  });
  return readJson(res, 'Google sign-in');
}

const toTokens = (t, prev = {}) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token || prev.refresh_token,
  expires_at: Date.now() + (t.expires_in || 3600) * 1000,
});

export async function handleCallback(code) {
  const tokens = toTokens(await tokenRequest({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  }));
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const { items = [] } = await readJson(res, 'YouTube');
  if (!items.length) {
    throw new Error('That Google account has no YouTube channel. Create one on YouTube, then connect again.');
  }
  for (const ch of items) {
    accounts.upsert({
      platform: 'youtube',
      externalId: ch.id,
      name: ch.snippet.title,
      avatar: ch.snippet.thumbnails?.default?.url || null,
      tokens,
    });
  }
  return items.length;
}

async function accessToken(acc) {
  const t = acc.tokens;
  if (t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
  if (!t.refresh_token) throw new Error('Sign-in expired. Disconnect and reconnect this channel.');
  const fresh = toTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }), t);
  accounts.update(acc.id, { tokens: fresh });
  return fresh.access_token;
}

const clean = (s) => s.replace(/[<>]/g, '');

export async function publish(acc, file, post, progress) {
  const token = await accessToken(acc);

  let title = clean(post.title).slice(0, 100);
  let description = clean(post.description);
  if (post.shorts && !/#shorts/i.test(`${title} ${description}`)) {
    if (title.length + 8 <= 100) title += ' #Shorts';
    else description = `${description}\n\n#Shorts`.trim();
  }
  if (post.hashtags.length) {
    description = `${description}\n\n${post.hashtags.map((t) => `#${t}`).join(' ')}`.trim();
  }

  const metadata = {
    snippet: {
      title,
      description: description.slice(0, 5000),
      tags: post.hashtags.slice(0, 30),
      categoryId: '22',
    },
    status: {
      privacyStatus: post.youtubePrivacy,
      selfDeclaredMadeForKids: post.madeForKids,
    },
  };

  progress('Starting upload');
  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(file.size),
        'X-Upload-Content-Type': file.mimetype,
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!init.ok) await readJson(init, 'YouTube');
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube did not return an upload address.');

  progress('Uploading video');
  const blob = await fs.openAsBlob(file.path, { type: file.mimetype });
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.mimetype },
    body: blob,
  });
  const video = await readJson(res, 'YouTube upload');
  return {
    id: video.id,
    url: post.shorts ? `https://www.youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}`,
  };
}
