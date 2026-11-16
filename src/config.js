import path from 'node:path';
import dotenv from 'dotenv';

export const ROOT = path.resolve(import.meta.dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const env = (name) => (process.env[name] || '').trim();

export const PORT = Number(env('PORT')) || 3000;
// Where you open the app in your browser. Google and Meta allow http://localhost redirects.
export const LOCAL_URL = `http://localhost:${PORT}`;
// Optional public https tunnel to this app (needed by TikTok, fallback for Instagram).
export const PUBLIC_URL = env('PUBLIC_URL').replace(/\/+$/, '');

export const cfg = {
  youtube: { clientId: env('YOUTUBE_CLIENT_ID'), clientSecret: env('YOUTUBE_CLIENT_SECRET') },
  tiktok: { clientKey: env('TIKTOK_CLIENT_KEY'), clientSecret: env('TIKTOK_CLIENT_SECRET') },
  meta: {
    appId: env('META_APP_ID'),
    appSecret: env('META_APP_SECRET'),
    version: env('META_API_VERSION') || 'v24.0',
  },
};
