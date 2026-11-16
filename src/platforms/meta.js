// Facebook Pages and Instagram Reels share one Meta (Facebook) login.
import fs from 'node:fs';
import { cfg, LOCAL_URL, PUBLIC_URL } from '../config.js';
import { accounts } from '../store.js';
import { readJson, buildCaption, sleep, media } from '../util.js';

const V = cfg.meta.version;
const GRAPH = `https://graph.facebook.com/${V}`;
const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
];
const redirectUri = () => `${LOCAL_URL}/auth/meta/callback`;

export function setupIssue() {
  if (!cfg.meta.appId || !cfg.meta.appSecret) {
    return 'Add META_APP_ID and META_APP_SECRET to .env, then restart (see README).';
  }
  return null;
}

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: cfg.meta.appId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
  });
  return `https://www.facebook.com/${V}/dialog/oauth?${p}`;
}

const get = async (pathname, params, label = 'Facebook') =>
  readJson(await fetch(`${GRAPH}${pathname}?${new URLSearchParams(params)}`), label);

const post = async (url, params, label) =>
  readJson(await fetch(url, { method: 'POST', body: new URLSearchParams(params) }), label);

export async function handleCallback(code) {
  const short = await get('/oauth/access_token', {
    client_id: cfg.meta.appId,
    client_secret: cfg.meta.appSecret,
    redirect_uri: redirectUri(),
    code,
  });
  // A long-lived user token makes the Page tokens below non-expiring.
  const long = await get('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: cfg.meta.appId,
    client_secret: cfg.meta.appSecret,
    fb_exchange_token: short.access_token,
  });
  const pages = await get('/me/accounts', {
    fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
    limit: '100',
    access_token: long.access_token,
  });

  let count = 0;
  for (const page of pages.data || []) {
    accounts.upsert({
      platform: 'facebook',
      externalId: page.id,
      name: page.name,
      avatar: page.picture?.data?.url || null,
      tokens: { access_token: page.access_token },
    });
    count++;
    const ig = page.instagram_business_account;
    if (ig) {
      accounts.upsert({
        platform: 'instagram',
        externalId: ig.id,
        name: ig.username ? `@${ig.username}` : `${page.name} (Instagram)`,
        avatar: ig.profile_picture_url || null,
        pageId: page.id,
        tokens: { access_token: page.access_token },
      });
      count++;
    }
  }
  if (!count) {
    throw new Error(
      'No Facebook Pages were shared. Connect again and tick your Page(s) and Instagram account(s) when Facebook asks.',
    );
  }
  return count;
}

export async function publishFacebook(acc, file, p, progress) {
  progress('Uploading video');
  const form = new FormData();
  form.append('access_token', acc.tokens.access_token);
  form.append('title', p.title.slice(0, 255));
  form.append('description', buildCaption(p, 5000, { includeTitle: false }));
  form.append('source', await fs.openAsBlob(file.path, { type: file.mimetype }), file.originalname || 'video.mp4');
  const res = await fetch(`https://graph-video.facebook.com/${V}/${acc.externalId}/videos`, {
    method: 'POST',
    body: form,
  });
  const video = await readJson(res, 'Facebook');
  return { id: video.id, url: `https://www.facebook.com/${acc.externalId}/videos/${video.id}` };
}

export async function publishInstagram(acc, file, p, progress) {
  const token = acc.tokens.access_token;
  const igId = acc.externalId;
  const reel = {
    media_type: 'REELS',
    caption: buildCaption(p, 2200),
    share_to_feed: 'true',
    access_token: token,
  };
  let containerId;
  let shareKey;

  try {
    progress('Creating Reel');
    try {
      // Preferred: upload the file straight to Instagram.
      const c = await post(`${GRAPH}/${igId}/media`, { ...reel, upload_type: 'resumable' }, 'Instagram');
      containerId = c.id;
      progress('Uploading video');
      const res = await fetch(`https://rupload.facebook.com/ig-api-upload/${V}/${containerId}`, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${token}`,
          offset: '0',
          file_size: String(file.size),
        },
        body: await fs.openAsBlob(file.path),
      });
      await readJson(res, 'Instagram upload');
    } catch (err) {
      // Fallback: let Instagram download the video from a temporary public link.
      if (!PUBLIC_URL.startsWith('https://')) throw err;
      console.warn('Instagram direct upload failed, trying public link:', err.message);
      progress('Retrying with a temporary link');
      const shared = media.share(file, PUBLIC_URL);
      shareKey = shared.key;
      const c = await post(`${GRAPH}/${igId}/media`, { ...reel, video_url: shared.url }, 'Instagram');
      containerId = c.id;
    }

    progress('Instagram is processing the video');
    for (let i = 0; ; i++) {
      await sleep(5000);
      const s = await get(`/${containerId}`, { fields: 'status_code,status', access_token: token }, 'Instagram');
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
        throw new Error(`Instagram could not process the video: ${s.status || s.status_code}`);
      }
      if (i >= 180) throw new Error('Instagram took too long to process the video (15 min).');
    }

    progress('Publishing Reel');
    const published = await post(
      `${GRAPH}/${igId}/media_publish`,
      { creation_id: containerId, access_token: token },
      'Instagram',
    );
    let url = null;
    try {
      url = (await get(`/${published.id}`, { fields: 'permalink', access_token: token }, 'Instagram')).permalink;
    } catch { /* link is optional */ }
    return { id: published.id, url };
  } finally {
    if (shareKey) media.unshare(shareKey);
  }
}
