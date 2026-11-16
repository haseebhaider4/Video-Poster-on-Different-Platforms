import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { PORT, LOCAL_URL, PUBLIC_URL, ROOT } from './src/config.js';
import { accounts, history } from './src/store.js';
import { parseTags, media } from './src/util.js';
import * as youtube from './src/platforms/youtube.js';
import * as tiktok from './src/platforms/tiktok.js';
import * as meta from './src/platforms/meta.js';

// Sign-in providers (Facebook + Instagram share the Meta login).
const providers = { youtube, tiktok, meta };
// How to post to each kind of connected account.
const publishers = {
  youtube: youtube.publish,
  tiktok: tiktok.publish,
  facebook: meta.publishFacebook,
  instagram: meta.publishInstagram,
};

const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
for (const f of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 4 * 1024 ** 3 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('video/')),
});

const app = express();
app.disable('x-powered-by');

// Only your own browser on this computer gets the dashboard. If you run a tunnel
// (PUBLIC_URL), the internet can reach just the TikTok sign-in return page and
// temporary Instagram video links — nothing else.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
app.use((req, res, next) => {
  const fromThisPc =
    LOCAL_HOSTS.has(req.hostname) && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
  if (fromThisPc) return next();
  if (req.method === 'GET' && (req.path === '/auth/tiktok/callback' || req.path.startsWith('/media/'))) return next();
  res.status(403).send('Forbidden');
});

// Block other websites from triggering API calls in your browser.
app.use('/api', (req, res, next) => {
  if (req.get('X-Requested-With') === 'crosspost') return next();
  res.status(403).json({ error: 'Forbidden' });
});

app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    providers: Object.fromEntries(Object.entries(providers).map(([k, p]) => [k, { issue: p.setupIssue() }])),
    accounts: accounts.all().map(({ tokens, ...a }) => a),
    publicUrl: PUBLIC_URL || null,
  });
});

app.delete('/api/accounts/:id', (req, res) => {
  res.json({ removed: accounts.remove(req.params.id) });
});

app.get('/api/history', (req, res) => res.json(history.all()));

// ---- Sign-in ----
const pendingStates = new Map();

app.get('/auth/:provider', (req, res) => {
  const p = providers[req.params.provider];
  if (!p) return res.sendStatus(404);
  const issue = p.setupIssue();
  if (issue) return res.redirect(`/?${new URLSearchParams({ error: issue })}`);
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { provider: req.params.provider, at: Date.now() });
  res.redirect(p.authUrl(state));
});

app.get('/auth/:provider/callback', async (req, res) => {
  const back = (q) => res.redirect(`${LOCAL_URL}/?${new URLSearchParams(q)}`);
  const state = String(req.query.state || '');
  const saved = pendingStates.get(state);
  pendingStates.delete(state);
  if (!saved || saved.provider !== req.params.provider || Date.now() - saved.at > 15 * 60_000) {
    return back({ error: 'That sign-in link expired or was invalid. Please try connecting again.' });
  }
  const { code, error, error_description: desc } = req.query;
  if (error || !code) return back({ error: String(desc || error || 'Sign-in was cancelled.') });
  try {
    const count = await providers[req.params.provider].handleCallback(String(code));
    back({ connected: req.params.provider, count: String(count) });
  } catch (err) {
    console.error(`[${req.params.provider}] sign-in failed:`, err);
    back({ error: err.message });
  }
});

// Temporary links Instagram can download from (only while a post is in progress).
app.get('/media/:key', (req, res) => {
  const file = media.lookup(req.params.key);
  if (!file) return res.sendStatus(404);
  res.type(file.mimetype);
  res.sendFile(file.path);
});

// ---- Posting ----
const jobs = new Map();
const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

app.post('/api/post', upload.single('video'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Please choose a video file.' });
  const b = req.body;

  let ids = [];
  try { ids = JSON.parse(b.accounts || '[]'); } catch { /* empty */ }
  const targets = (Array.isArray(ids) ? ids : []).map((id) => accounts.get(id)).filter(Boolean);
  if (!targets.length) {
    fs.rm(file.path, { force: true }, () => {});
    return res.status(400).json({ error: 'Pick at least one account to post to.' });
  }

  const post = {
    title: String(b.title || '').trim() || path.parse(file.originalname).name,
    description: String(b.description || '').trim(),
    hashtags: parseTags(b.hashtags),
    youtubePrivacy: ['public', 'unlisted', 'private'].includes(b.youtubePrivacy) ? b.youtubePrivacy : 'public',
    shorts: b.shorts === 'true',
    madeForKids: b.madeForKids === 'true',
    tiktokPrivacy: TIKTOK_PRIVACY.includes(b.tiktokPrivacy) ? b.tiktokPrivacy : 'PUBLIC_TO_EVERYONE',
  };

  const job = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: post.title,
    done: false,
    results: targets.map((a) => ({
      accountId: a.id,
      platform: a.platform,
      name: a.name,
      state: 'pending',
      message: 'Waiting',
      url: null,
    })),
  };
  jobs.set(job.id, job);
  runJob(job, targets, file, post);
  res.json({ jobId: job.id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

async function runJob(job, targets, file, post) {
  const video = { path: file.path, size: file.size, mimetype: file.mimetype, originalname: file.originalname };
  await Promise.all(targets.map(async (acc, i) => {
    const r = job.results[i];
    const progress = (msg) => { r.state = 'working'; r.message = msg; };
    try {
      progress('Starting');
      const out = await publishers[acc.platform](acc, video, post, progress);
      r.state = 'done';
      r.url = out.url || null;
      r.message = out.note || 'Posted';
    } catch (err) {
      r.state = 'failed';
      r.message = err.message;
      console.error(`[${acc.platform}] ${acc.name}:`, err);
    }
  }));
  job.done = true;
  fs.rm(file.path, { force: true }, () => {});
  history.add({
    id: job.id,
    createdAt: job.createdAt,
    title: job.title,
    results: job.results.map(({ platform, name, state, message, url }) => ({ platform, name, state, message, url })),
  });
  setTimeout(() => jobs.delete(job.id), 60 * 60_000).unref();
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That video is over the 4 GB limit.' : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Check the terminal for details.' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  CrossPost is running at ${LOCAL_URL}\n`);
  for (const [name, p] of Object.entries(providers)) {
    const issue = p.setupIssue();
    console.log(`  ${issue ? '✗' : '✓'} ${name.padEnd(8)} ${issue || 'ready'}`);
  }
  console.log('');
});
