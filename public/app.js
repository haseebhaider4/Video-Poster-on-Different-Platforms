const PLATFORMS = {
  youtube: { label: 'YouTube', color: '#e62117', provider: 'youtube', connect: 'Connect' },
  tiktok: { label: 'TikTok', color: '#111111', provider: 'tiktok', connect: 'Connect' },
  instagram: { label: 'Instagram Reels', color: '#c13584', provider: 'meta', connect: 'Connect via Facebook' },
  facebook: { label: 'Facebook Page', color: '#1877f2', provider: 'meta', connect: 'Connect' },
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https:\/\//.test(u || '') ? u : null);

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'X-Requested-With': 'crosspost', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

let status = { accounts: [], providers: {} };
let selectedFile = null;
const unchecked = new Set();

function flash(msg, kind = 'ok') {
  const el = $('#flash');
  el.textContent = msg;
  el.className = `flash ${kind}`;
  el.hidden = false;
  clearTimeout(flash.t);
  if (kind === 'ok') flash.t = setTimeout(() => { el.hidden = true; }, 6000);
}

// ---- Accounts ----
async function loadStatus() {
  status = await api('/api/status');
  renderPlatforms();
  renderTargets();
}

function renderPlatforms() {
  $('#platforms').innerHTML = Object.entries(PLATFORMS).map(([key, p]) => {
    const list = status.accounts.filter((a) => a.platform === key);
    const issue = status.providers[p.provider]?.issue;
    const button = issue ? '' : `<a class="btn" href="/auth/${p.provider}">${list.length ? 'Add another' : p.connect}</a>`;
    const accs = list.map((a) => `
      <div class="acc">
        ${safeUrl(a.avatar) ? `<img src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
        <span title="${esc(a.name)}">${esc(a.name)}</span>
        <button class="link" type="button" data-remove="${esc(a.id)}" data-name="${esc(a.name)}">Disconnect</button>
      </div>`).join('');
    let hint = '';
    if (issue) hint = `<p class="hint">${esc(issue)}</p>`;
    else if (!list.length && key === 'instagram') hint = '<p class="hint">Needs an Instagram Business or Creator account linked to a Facebook Page. Connecting Facebook adds both.</p>';
    else if (!list.length) hint = '<p class="hint">No accounts connected yet.</p>';
    return `<div class="platform">
      <div class="p-head"><span class="badge" style="--c:${p.color}">${p.label[0]}</span><strong>${p.label}</strong>${button}</div>
      ${hint}${accs}
    </div>`;
  }).join('');
}

function renderTargets() {
  const el = $('#targets');
  if (!status.accounts.length) {
    el.innerHTML = '<p class="empty">Connect at least one account on the right to start posting.</p>';
    return;
  }
  const order = Object.keys(PLATFORMS);
  const sorted = [...status.accounts].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
  el.innerHTML = sorted.map((a) => `
    <label class="check">
      <input type="checkbox" value="${esc(a.id)}" ${unchecked.has(a.id) ? '' : 'checked'}>
      <span class="badge" style="--c:${PLATFORMS[a.platform].color};width:18px;height:18px;font-size:10px;border-radius:5px">${PLATFORMS[a.platform].label[0]}</span>
      ${esc(a.name)} <span class="muted">· ${PLATFORMS[a.platform].label}</span>
    </label>`).join('');
}

$('#targets').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  e.target.checked ? unchecked.delete(e.target.value) : unchecked.add(e.target.value);
});

$('#platforms').addEventListener('click', async (e) => {
  const id = e.target.dataset?.remove;
  if (!id) return;
  if (!confirm(`Disconnect ${e.target.dataset.name}? You can connect it again any time.`)) return;
  try {
    await api(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadStatus();
  } catch (err) { flash(err.message, 'bad'); }
});

// ---- Video picker ----
const input = $('#video');
const drop = $('#drop');
const preview = $('#preview');

function formatSize(b) {
  return b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`;
}

function setFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) { flash('That file is not a video.', 'bad'); return; }
  selectedFile = file;
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  $('#dropEmpty').hidden = true;
  $('#fileInfo').innerHTML = `${esc(file.name)} · ${formatSize(file.size)} <button class="link" type="button" id="clearFile">Remove</button>`;
}

preview.addEventListener('loadedmetadata', () => {
  // Vertical and 3 min or less → it's a Short.
  const vertical = preview.videoHeight > preview.videoWidth;
  $('#shorts').checked = vertical && preview.duration <= 180;
  const mins = Math.floor(preview.duration / 60);
  const secs = String(Math.round(preview.duration % 60)).padStart(2, '0');
  const shape = vertical ? 'vertical' : preview.videoWidth === preview.videoHeight ? 'square' : 'horizontal';
  $('#fileInfo').insertAdjacentHTML('afterbegin', `${mins}:${secs} · ${shape} · `);
});

$('#fileInfo').addEventListener('click', (e) => {
  if (e.target.id !== 'clearFile') return;
  selectedFile = null;
  input.value = '';
  preview.removeAttribute('src');
  preview.hidden = true;
  $('#dropEmpty').hidden = false;
  $('#fileInfo').textContent = '';
});

input.addEventListener('change', () => setFile(input.files[0]));
drop.addEventListener('click', (e) => { if (e.target === preview) e.preventDefault(); });
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => setFile(e.dataTransfer.files[0]));

$('#title').addEventListener('input', (e) => { $('#titleCount').textContent = `${e.target.value.length}/100`; });

// ---- Posting ----
function uploadWithProgress(form) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const bar = $('#uploadBar');
    bar.hidden = false;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      bar.firstElementChild.style.width = `${pct}%`;
      bar.lastElementChild.textContent = pct < 100 ? `Uploading to CrossPost… ${pct}%` : 'Sending to platforms…';
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* empty */ }
      xhr.status < 300 ? resolve(body) : reject(new Error(body.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Is CrossPost still running?'));
    xhr.open('POST', '/api/post');
    xhr.setRequestHeader('X-Requested-With', 'crosspost');
    xhr.send(form);
  });
}

function renderResults(job) {
  $('#jobCard').hidden = false;
  $('#jobResults').innerHTML = job.results.map((r) => {
    const label = { pending: 'Waiting', working: 'Working', done: 'Done', failed: 'Failed' }[r.state];
    const url = safeUrl(r.url);
    return `<li class="result">
      <span class="badge" style="--c:${PLATFORMS[r.platform].color}">${PLATFORMS[r.platform].label[0]}</span>
      <div class="body">
        <div class="name">${esc(r.name)}</div>
        <div class="msg">${esc(r.message)}</div>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">View post ↗</a>` : ''}
      </div>
      <span class="pill ${r.state}">${label}</span>
    </li>`;
  }).join('');
}

async function watchJob(id) {
  for (;;) {
    const job = await api(`/api/jobs/${id}`);
    renderResults(job);
    if (job.done) return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

$('#postForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedFile) { flash('Choose a video first.', 'bad'); return; }
  const ids = [...document.querySelectorAll('#targets input:checked')].map((c) => c.value);
  if (!ids.length) { flash('Pick at least one account to post to.', 'bad'); return; }

  const form = new FormData();
  form.append('title', $('#title').value);
  form.append('description', $('#description').value);
  form.append('hashtags', $('#hashtags').value);
  form.append('youtubePrivacy', $('#youtubePrivacy').value);
  form.append('tiktokPrivacy', $('#tiktokPrivacy').value);
  form.append('shorts', String($('#shorts').checked));
  form.append('madeForKids', String($('#madeForKids').checked));
  form.append('accounts', JSON.stringify(ids));
  form.append('video', selectedFile);

  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    const { jobId } = await uploadWithProgress(form);
    $('#uploadBar').hidden = true;
    const job = await watchJob(jobId);
    const failed = job.results.filter((r) => r.state === 'failed').length;
    if (failed) flash(`Finished, but ${failed} of ${job.results.length} failed. See the details on the right.`, 'bad');
    else flash(`Posted to all ${job.results.length} account${job.results.length > 1 ? 's' : ''}.`);
    loadHistory();
  } catch (err) {
    flash(err.message, 'bad');
  } finally {
    $('#uploadBar').hidden = true;
    btn.disabled = false;
    btn.textContent = 'Post everywhere';
  }
});

// ---- History ----
async function loadHistory() {
  const items = await api('/api/history');
  $('#history').innerHTML = items.length
    ? items.slice(0, 15).map((h) => `<li>
        <div class="h-title">${esc(h.title)}</div>
        <div class="h-date">${new Date(h.createdAt).toLocaleString()}</div>
        <div class="h-list">${h.results.map((r) => {
          const url = safeUrl(r.url);
          const text = `${PLATFORMS[r.platform].label}: ${esc(r.name)}`;
          return url
            ? `<a class="chip ${r.state}" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(r.message)}">${text} ↗</a>`
            : `<span class="chip ${r.state}" title="${esc(r.message)}">${text}</span>`;
        }).join('')}</div>
      </li>`).join('')
    : '<li class="muted">Nothing posted yet.</li>';
}

// ---- Start ----
(function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('error')) flash(q.get('error'), 'bad');
  else if (q.get('connected')) {
    const n = Number(q.get('count')) || 1;
    const name = { youtube: 'YouTube', tiktok: 'TikTok', meta: 'Facebook / Instagram' }[q.get('connected')] || 'Account';
    flash(`${name} connected (${n} account${n > 1 ? 's' : ''}).`);
  }
  if (q.toString()) history.replaceState(null, '', '/');
})();

loadStatus().catch((err) => flash(err.message, 'bad'));
loadHistory().catch(() => {});
