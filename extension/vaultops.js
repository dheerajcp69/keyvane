// Shared vault operations for the popup and the background service worker.
import * as C from './crypto.js';
import * as Store from './store.js';

const session = chrome.storage.session;

export function hostOf(u) {
  if (!u) return '';
  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + String(u).trim();
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
}

export function originOf(u) {
  try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).origin; } catch { return ''; }
}

export function siteMatch(a, b) {
  return !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));
}

export const uid = () => C.b64(C.randomBytes(12)).replace(/[+/=]/g, '');

/* ---- "known logins" index ----
   Lets the background worker tell, even while the vault is locked, whether a
   login it just saw is already saved. Salted hashes only, kept in session
   memory (cleared when Chrome closes), readable only by the extension. */
async function sha(salt, s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '\u0000' + s));
  return C.b64(d).slice(0, 24);
}

export async function writeKnown(entries) {
  let { knownSalt } = await session.get('knownSalt');
  if (!knownSalt) { knownSalt = C.b64(C.randomBytes(16)); }
  const known = {};
  for (const e of entries) {
    if (e.deleted || !e.host) continue;
    known[await sha(knownSalt, e.host + '\n' + (e.username || ''))] = await sha(knownSalt, 'pw:' + (e.password || ''));
  }
  await session.set({ knownSalt, known });
}

// 'same' | 'changed' | 'new' | 'unknown' (vault never unlocked this session)
export async function checkKnown(host, username, password) {
  const { known, knownSalt } = await session.get(['known', 'knownSalt']);
  if (!known || !knownSalt) return 'unknown';
  const k = known[await sha(knownSalt, host + '\n' + (username || ''))];
  if (!k) return 'new';
  return k === (await sha(knownSalt, 'pw:' + password)) ? 'same' : 'changed';
}

/* ---- unlocked key from the popup's session ---- */
export async function getSessionKey() {
  const { key, lastActive } = await session.get(['key', 'lastActive']);
  if (!key) return null;
  const { settings } = await chrome.storage.sync.get('settings');
  const mins = settings?.autoLock ?? 15;
  if (mins > 0 && Date.now() - (lastActive || 0) > mins * 60000) {
    await session.remove(['key', 'lastActive']);
    return null;
  }
  try { return await C.importKey(key); } catch { return null; }
}

export async function readEntries(key) {
  const vault = await Store.readVault();
  if (!vault) return null;
  if (vault.partial) throw Object.assign(new Error('Still syncing'), { code: 'SYNCING' });
  return { vault, entries: (await C.decryptJSON(key, vault)).entries || [] };
}

export function findLogin(entries, host, username) {
  return entries.find(e => !e.deleted && e.host === host && (e.username || '') === (username || ''));
}

// Add a new login, or update the password of the same site + username.
export async function upsertLogin(key, cred) {
  const { vault, entries } = await readEntries(key);
  const now = Date.now();
  const ex = findLogin(entries, cred.host, cred.username);
  if (ex) { ex.password = cred.password; ex.updated = now; }
  else entries.push({ id: uid(), url: cred.origin || 'https://' + cred.host, host: cred.host, title: '', username: cred.username || '', password: cred.password, notes: '', created: now, updated: now });
  const blob = await C.encryptJSON(key, { entries });
  await Store.writeVault({ ...vault, ...blob, v: 2, updated: now });
  await session.set({ lastActive: now });
  await writeKnown(entries);
  return ex ? 'updated' : 'saved';
}

/* ---- pending "save this login?" offers ---- */
export async function getPending() {
  const { pending = [] } = await session.get('pending');
  const cutoff = Date.now() - 24 * 3600e3;
  return pending.filter(p => p.ts > cutoff);
}
export async function setPending(list) {
  await session.set({ pending: list });
  const n = list.length;
  try {
    await chrome.action.setBadgeText({ text: n ? String(n) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
  } catch {}
}

/* ---- CSV import (Chrome, Edge, Brave, Firefox, Bitwarden, LastPass, 1Password, Dashlane, Proton…) ---- */
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

const COLS = {
  url: ['url', 'login_uri', 'website', 'web site', 'login url', 'uri', 'origin', 'hostname', 'site', 'address', 'urls'],
  username: ['username', 'login_username', 'user name', 'login', 'email', 'user', 'login name', 'e-mail', 'email address', 'username1'],
  password: ['password', 'login_password', 'pass', 'passwd'],
  title: ['name', 'title', 'account', 'item name'],
  notes: ['note', 'notes', 'extra', 'comment', 'comments']
};

export function csvToLogins(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { logins: [], skipped: 0, error: 'The file has no rows.' };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = k => head.findIndex(h => COLS[k].includes(h));
  const ix = { url: col('url'), username: col('username'), password: col('password'), title: col('title'), notes: col('notes') };
  if (ix.password < 0 || ix.url < 0) return { logins: [], skipped: 0, error: "Couldn't find website and password columns. Export a CSV of passwords from your browser or password manager." };
  const logins = []; let skipped = 0;
  for (const r of rows.slice(1)) {
    const get = k => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
    const rawUrl = get('url').split(/[\s,]+/)[0];
    const password = ix.password >= 0 ? r[ix.password] || '' : '';
    const host = hostOf(rawUrl);
    if (!host || !password) { skipped++; continue; }
    const title = get('title');
    logins.push({ url: originOf(rawUrl) || rawUrl, host, title: title && title.toLowerCase() !== host ? title : '', username: get('username'), password, notes: get('notes') });
  }
  return { logins, skipped };
}
