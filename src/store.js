import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './config.js';

const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

function save(file, data) {
  const target = path.join(DATA_DIR, file);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

/** Connected accounts, including their sign-in tokens. Stored in data/accounts.json. */
export const accounts = {
  all() {
    return load('accounts.json', []);
  },
  get(id) {
    return this.all().find((a) => a.id === id);
  },
  /** Insert, or update the existing entry for the same platform + external id. */
  upsert(account) {
    const list = this.all();
    const i = list.findIndex((a) => a.platform === account.platform && a.externalId === account.externalId);
    let saved;
    if (i >= 0) {
      saved = list[i] = { ...list[i], ...account, id: list[i].id };
    } else {
      saved = { id: crypto.randomUUID(), connectedAt: new Date().toISOString(), ...account };
      list.push(saved);
    }
    save('accounts.json', list);
    return saved;
  },
  update(id, patch) {
    const list = this.all();
    const i = list.findIndex((a) => a.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    save('accounts.json', list);
    return list[i];
  },
  remove(id) {
    const list = this.all();
    const next = list.filter((a) => a.id !== id);
    save('accounts.json', next);
    return next.length !== list.length;
  },
};

/** The last 50 posts and how each platform went. Stored in data/history.json. */
export const history = {
  all() {
    return load('history.json', []);
  },
  add(entry) {
    save('history.json', [entry, ...this.all()].slice(0, 50));
  },
};
