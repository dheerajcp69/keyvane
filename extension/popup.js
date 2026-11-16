import * as C from './crypto.js';
import * as Store from './store.js';
import * as V from './vaultops.js';

const REVIEW_URL = 'https://chromewebstore.google.com/detail/occfjinobiaefhbkngbolamflknedmlo/reviews';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const IN_TAB = new URLSearchParams(location.search).has('tab');
const UNLOCK_WIN = new URLSearchParams(location.search).has('unlock');
if (IN_TAB) { document.body.classList.add('in-tab'); document.documentElement.classList.add('in-tab'); }

const session = chrome.storage.session;

const S = {
  key: null,
  entries: [],
  tab: null,
  tabHost: '',
  query: '',
  settings: { autoLock: 15 },
  gen: { length: 20, upper: true, digits: true, symbols: true }
};

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => C.b64(C.randomBytes(12)).replace(/[+/=]/g, '');
const $ = sel => app.querySelector(sel);

function hostOf(u) {
  if (!u) return '';
  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u.trim();
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
}
function siteMatch(a, b) {
  return !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));
}
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

let toastTimer;
function toast(msg, kind = 'ok') {
  toastEl.textContent = msg;
  toastEl.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ''), 2000);
}

let clipTimer;
async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`);
    clearTimeout(clipTimer);
    clipTimer = setTimeout(async () => {
      try { if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText(''); } catch {}
    }, 30000);
  } catch { toast('Clipboard blocked', 'bad'); }
}

async function touch() { if (S.key) await session.set({ lastActive: Date.now() }); }

/* ---------- icons ---------- */
const I = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="#fff"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.2A10.6 10.6 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.3M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M15 8l2 2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/></svg>',
  fill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 3 1.8 4.2L19 9l-4.2 1.8L13 15l-1.8-4.2L7 9l4.2-1.8z"/><path d="M5 17l.9 2.1L8 20l-2.1.9L5 23l-.9-2.1L2 20l2.1-.9z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12l-4 4H4z"/><path d="M8 9h8M8 13h5"/></svg>'
};

/* ---------- vault I/O (synced via Chrome sign-in) ---------- */
const getVault = () => Store.readVault();
const live = () => S.entries.filter(e => !e.deleted);

// Merge two entry lists by id; newest `updated` wins (deletes are tombstones).
function merge(a, b) {
  const map = new Map();
  for (const e of [...a, ...b]) {
    const cur = map.get(e.id);
    if (!cur || (e.updated || 0) > (cur.updated || 0)) map.set(e.id, e);
  }
  const cutoff = Date.now() - 180 * 864e5; // forget tombstones after 6 months
  return [...map.values()].filter(e => !e.deleted || e.updated > cutoff);
}

let saving = false;
async function persist() {
  saving = true;
  try {
    const remote = await getVault();
    if (remote?.partial) { const e = new Error('Still syncing — try again in a moment.'); e.code = 'QUOTA'; throw e; }
    if (remote && remote.updated !== S.syncedAt) {
      // Another device saved since we loaded — fold its changes in first.
      try { S.entries = merge((await C.decryptJSON(S.key, remote)).entries || [], S.entries); }
      catch {
        if (remote.salt === S.salt) { const e = new Error('Still syncing — try again in a moment.'); e.code = 'QUOTA'; throw e; }
        await lock('Master password was changed on another device'); throw new Error('locked');
      }
    }
    const blob = await C.encryptJSON(S.key, { entries: S.entries });
    const updated = Date.now();
    await Store.writeVault({ ...remote, ...blob, v: 2, updated });
    S.syncedAt = updated;
    await touch();
    V.writeKnown(S.entries);
  } catch (e) {
    if (e.code === 'QUOTA') toast(e.message, 'bad');
    throw e;
  } finally {
    setTimeout(() => (saving = false), 300);
  }
}

async function createVault(password) {
  const salt = C.randomBytes(16);
  const iter = C.DEFAULT_ITERATIONS;
  const key = await C.deriveKey(password, salt, iter);
  const blob = await C.encryptJSON(key, { entries: [] });
  const now = Date.now();
  await Store.writeVault({ v: 2, kdf: 'PBKDF2-SHA256', salt: C.b64(salt), iter, ...blob, created: now, updated: now });
  await openSession(key, [], now, C.b64(salt));
}

async function unlockVault(password) {
  const vault = await getVault();
  if (vault.partial) return 'syncing';
  const key = await C.deriveKey(password, C.unb64(vault.salt), vault.iter);
  let data;
  try { data = await C.decryptJSON(key, vault); } catch { return false; }
  await openSession(key, data.entries || [], vault.updated, vault.salt);
  return true;
}

async function openSession(key, entries, syncedAt, salt) {
  S.key = key;
  if (salt) S.salt = salt;
  S.entries = entries;
  S.syncedAt = syncedAt;
  await session.set({ key: await C.exportKey(key), lastActive: Date.now() });
  V.writeKnown(entries);
}

async function lock(msg) {
  S.key = null;
  S.entries = [];
  await session.remove(['key', 'lastActive']);
  renderUnlock();
  if (typeof msg === 'string') toast(msg, 'bad');
}

async function restoreSession() {
  const { key, lastActive } = await session.get(['key', 'lastActive']);
  if (!key) return false;
  const mins = S.settings.autoLock;
  if (mins > 0 && Date.now() - (lastActive || 0) > mins * 60000) {
    await session.remove(['key', 'lastActive']);
    return false;
  }
  try {
    const k = await C.importKey(key);
    const vault = await getVault();
    const data = await C.decryptJSON(k, vault);
    S.key = k;
    S.entries = data.entries || [];
    S.syncedAt = vault.updated;
    S.salt = vault.salt;
    await touch();
    V.writeKnown(S.entries);
    return true;
  } catch {
    await session.remove(['key', 'lastActive']);
    return false;
  }
}

// Live updates when another signed-in device changes the vault.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.vmeta || saving || !S.key) return;
  const vault = await getVault();
  if (!vault || vault.partial || vault.updated === S.syncedAt) return;
  try {
    S.entries = merge(S.entries, (await C.decryptJSON(S.key, vault)).entries || []);
    S.syncedAt = vault.updated;
    V.writeKnown(S.entries);
    if (S.view === 'list') drawResults();
    if (!changes.vmeta.newValue?.bg) toast('Synced');
  } catch { if (vault.salt !== S.salt) lock('Master password was changed on another device'); }
});

/* ---------- shared bits ---------- */
function meterHTML(id) {
  return `<div class="meter" id="${id}" data-s="0"><i></i><i></i><i></i><i></i></div>
          <div class="meter-label"><span id="${id}-l">&nbsp;</span><span id="${id}-b"></span></div>`;
}
function bindMeter(input, id) {
  const update = () => {
    const s = C.strength(input.value);
    $('#' + id).dataset.s = input.value ? Math.max(1, s.score) : 0;
    $('#' + id + '-l').textContent = input.value ? s.label : ' ';
    $('#' + id + '-b').textContent = input.value ? `~${s.bits} bits` : '';
  };
  input.addEventListener('input', update);
  update();
}
function bindEye(btn, input) {
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? I.eyeOff : I.eye;
    btn.title = show ? 'Hide' : 'Show';
  });
}
function fail(el, msg) {
  const e = $('.err');
  if (e) e.textContent = msg;
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}

/* ---------- views: setup / unlock ---------- */
function renderSetup() {
  S.view = 'setup';
  app.innerHTML = `
  <section class="view">
    <div class="top"><div class="brand"><div class="logo">${I.logo}</div>Keyvane</div></div>
    <div class="hero">
      <div class="hero-mark">${I.logo}</div>
      <div>
        <h1>Your passwords.<br><span class="grad">Only on this device.</span></h1>
        <p style="margin-top:8px">Create a master password to encrypt your vault.</p>
      </div>
      <form id="f" class="field" style="gap:10px" autocomplete="off">
        <div class="input-wrap">${I.key}<input id="p1" type="password" placeholder="Master password" autofocus>
          <div class="trail"><button type="button" class="icon-btn sm" id="eye" title="Show">${I.eye}</button></div></div>
        ${meterHTML('m')}
        <div class="input-wrap">${I.shield}<input id="p2" type="password" placeholder="Confirm master password"></div>
        <div class="err"></div>
        <button class="btn btn-primary block" id="go">Create vault</button>
      </form>
      <div class="note">${I.shield}<span>Encrypted with AES-256-GCM, key derived with PBKDF2 (600k rounds). Only the encrypted vault syncs, via your Chrome sign-in. <b>There is no recovery</b> — if you forget it, the vault can't be opened.</span></div>
    </div>
  </section>`;
  const p1 = $('#p1'), p2 = $('#p2'), f = $('#f');
  bindMeter(p1, 'm');
  bindEye($('#eye'), p1);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (p1.value.length < 8) return fail(f, 'Use at least 8 characters.');
    if (p1.value !== p2.value) return fail(f, "Passwords don't match.");
    const go = $('#go'); go.disabled = true; go.textContent = 'Encrypting…';
    await createVault(p1.value);
    toast('Vault created');
    if (location.hash === '#enable-save') return renderEnableSave();
    renderList();
  });
}

function renderUnlock() {
  S.view = 'unlock';
  app.innerHTML = `
  <section class="view">
    <div class="top"><div class="brand"><div class="logo">${I.logo}</div>Keyvane</div></div>
    <div class="hero">
      <div class="hero-mark">${I.lock.replace('currentColor', '#fff')}</div>
      <div>
        <h1>Welcome back.</h1>
        <p style="margin-top:6px">${S.tabHost ? `Unlock to see logins for <b style="color:var(--text)">${esc(S.tabHost)}</b>.` : 'Unlock your vault to continue.'}</p>
      </div>
      <form id="f" class="field" style="gap:10px">
        <div class="input-wrap">${I.key}<input id="pw" type="password" placeholder="Master password" autofocus autocomplete="current-password">
          <div class="trail"><button type="button" class="icon-btn sm" id="eye" title="Show">${I.eye}</button></div></div>
        <div class="err"></div>
        <button class="btn btn-primary block" id="go">${I.lock} Unlock</button>
      </form>
    </div>
  </section>`;
  const pw = $('#pw'), f = $('#f');
  bindEye($('#eye'), pw);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!pw.value) return fail(f, 'Enter your master password.');
    const go = $('#go'); go.disabled = true; go.textContent = 'Unlocking…';
    const ok = await unlockVault(pw.value);
    if (ok === 'syncing') { go.disabled = false; go.innerHTML = `${I.lock} Unlock`; return fail(f, 'Vault is still syncing — try again in a moment.'); }
    if (!ok) { go.disabled = false; go.innerHTML = `${I.lock} Unlock`; pw.select(); return fail(f, 'Wrong master password.'); }
    if (UNLOCK_WIN) { toast('Unlocked'); return setTimeout(() => window.close(), 500); }
    if (location.hash === '#settings' || location.hash === '#import') return renderSettings();
    if (location.hash === '#enable-save') return renderEnableSave();
    renderList();
  });
}

/* ---------- view: list ---------- */
function itemHTML(e, match) {
  const host = e.host || hostOf(e.url) || 'untitled';
  return `<li class="item ${match ? 'match' : ''}" data-id="${esc(e.id)}">
    <div class="avatar" style="--h:${hue(host)}">${esc(host[0] || '?')}</div>
    <div class="meta"><div class="h">${esc(e.title || host)}</div><div class="u">${esc(e.username || 'No username')}</div></div>
    <div class="actions">
      ${match && S.tab ? `<button class="icon-btn sm fill" data-act="fill" title="Fill on this page">${I.fill}</button>` : ''}
      ${e.username ? `<button class="icon-btn sm" data-act="cu" title="Copy username">${I.user}</button>` : ''}
      <button class="icon-btn sm" data-act="cp" title="Copy password">${I.key}</button>
    </div>
  </li>`;
}

function renderList() {
  S.view = 'list';
  app.innerHTML = `
  <section class="view">
    <div class="top">
      <div class="brand"><div class="logo">${I.logo}</div>Keyvane</div>
      <div class="spacer"></div>
      <button class="icon-btn" id="settings" title="Settings">${I.gear}</button>
      <button class="icon-btn" id="lock" title="Lock now">${I.lock}</button>
    </div>
    <div class="site-chip">
      <span class="dot ${S.tabHost ? '' : 'off'}"></span>
      <div style="min-width:0;flex:1">
        <div class="host">${S.tabHost ? esc(S.tabHost) : 'No website in this tab'}</div>
        <div class="sub" id="siteSub"></div>
      </div>
    </div>
    <div class="input-wrap">${I.search}<input id="q" placeholder="Search logins" value="${esc(S.query)}" autocomplete="off" spellcheck="false"></div>
    <div class="scroll" id="results"><div id="cards"></div><div id="rows"></div></div>
    <button class="btn btn-primary fab" id="add">${I.plus} New login</button>
  </section>`;

  $('#q').addEventListener('input', e => { S.query = e.target.value; drawResults(); });
  $('#lock').addEventListener('click', lock);
  $('#settings').addEventListener('click', renderSettings);
  $('#add').addEventListener('click', () => renderEditor(null));
  $('#rows').addEventListener('click', onListClick);
  $('#cards').addEventListener('click', onCardClick);
  drawResults();
  drawCards();
  if (!S.query) setTimeout(() => $('#q')?.focus(), 50);
}

function drawResults() {
  const q = S.query.trim().toLowerCase();
  const sorted = live().sort((a, b) => (a.title || a.host).localeCompare(b.title || b.host));
  const filtered = q
    ? sorted.filter(e => [e.title, e.host, e.url, e.username, e.notes].some(v => (v || '').toLowerCase().includes(q)))
    : sorted;
  const matches = filtered.filter(e => siteMatch(e.host, S.tabHost));
  const others = filtered.filter(e => !siteMatch(e.host, S.tabHost));
  const sub = $('#siteSub');
  const nMatch = live().filter(e => siteMatch(e.host, S.tabHost)).length;
  sub.textContent = S.tabHost ? (nMatch ? `${nMatch} saved login${nMatch > 1 ? 's' : ''} for this site` : 'Nothing saved for this site yet') : 'Open a website to see matching logins';

  let html = '';
  if (S.tabHost && !q) {
    html += `<div class="section-h"><span class="label">This site</span><span class="count">${matches.length}</span></div>`;
    html += matches.length
      ? `<ul class="list">${matches.map(e => itemHTML(e, true)).join('')}</ul>`
      : `<div class="empty"><b>No login for ${esc(S.tabHost)}</b>Tap “New login” — the URL is filled in for you.</div>`;
  }
  const rest = S.tabHost && !q ? others : filtered;
  if (rest.length || !S.tabHost || q) {
    html += `<div class="section-h"><span class="label">${q ? 'Results' : S.tabHost ? 'All other logins' : 'All logins'}</span><span class="count">${rest.length}</span></div>`;
    html += rest.length
      ? `<ul class="list">${rest.map(e => itemHTML(e, siteMatch(e.host, S.tabHost))).join('')}</ul>`
      : q ? `<div class="empty"><b>No matches</b>Try a different search.</div>`
          : `<div class="empty"><b>Your vault is empty</b>Bring your passwords over from Chrome or another password manager in one step.<button class="btn btn-ghost block" data-act="import" style="margin-top:12px">Import passwords</button></div>`;
  }
  $('#rows').innerHTML = html;
  $('#rows').querySelector('[data-act="import"]')?.addEventListener('click', openImport);
}

async function onListClick(ev) {
  const li = ev.target.closest('.item');
  if (!li) return;
  const e = live().find(x => x.id === li.dataset.id);
  if (!e) return;
  const act = ev.target.closest('[data-act]')?.dataset.act;
  await touch();
  if (act === 'cu') return copy(e.username, 'Username');
  if (act === 'cp') return copy(e.password, 'Password');
  if (act === 'fill') return fillOnPage(e);
  renderEditor(e);
}

/* ---------- autofill ---------- */
function injectedFill(username, password) {
  const visible = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.disabled && !el.readOnly;
  };
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')].filter(visible);
  const pw = inputs.find(i => i.type === 'password');
  const userLike = inputs.filter(i => /^(text|email|tel|)$/i.test(i.getAttribute('type') || '') &&
    (/user|login|email|mail|account|id|name/i.test(`${i.name} ${i.id} ${i.autocomplete} ${i.placeholder}`) || i.type === 'email'));
  let filled = 0;
  if (pw) {
    const before = userLike.filter(i => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    const u = before.pop();
    if (u && username) { setVal(u, username); filled++; }
    setVal(pw, password); filled++;
  } else if (username && userLike[0]) {
    setVal(userLike[0], username); filled++;
  }
  return filled;
}

async function fillOnPage(e) {
  if (!S.tab?.id || !siteMatch(e.host, S.tabHost)) return toast('This login is for another site', 'bad');
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: S.tab.id }, func: injectedFill, args: [e.username || '', e.password || ''] });
    if (res?.result) { toast('Filled'); bumpStat('fills'); if (!IN_TAB) setTimeout(() => window.close(), 450); }
    else toast('No login form found', 'bad');
  } catch { toast("Can't fill on this page", 'bad'); }
}

/* ---------- view: editor ---------- */
function renderEditor(entry) {
  S.view = 'editor';
  const isNew = !entry;
  const e = entry || { url: S.tab?.url && S.tabHost ? new URL(S.tab.url).origin : '', username: '', password: '', notes: '', title: '' };
  if (isNew && !e.password) e.password = C.generatePassword(S.gen);
  app.innerHTML = `
  <section class="view">
    <div class="top">
      <button class="icon-btn" id="back" title="Back">${I.back}</button>
      <div class="title">${isNew ? 'New login' : 'Edit login'}</div>
      <div class="spacer"></div>
      ${isNew ? '' : `<button class="icon-btn" id="copyAll" title="Copy password">${I.copy}</button>`}
    </div>
    <form id="f" style="display:flex;flex-direction:column;gap:12px" autocomplete="off">
      <div class="field"><label for="url">Website</label>
        <div class="input-wrap">${I.globe}<input id="url" placeholder="example.com" value="${esc(e.url)}" spellcheck="false"></div></div>
      <div class="field"><label for="title">Name <span style="text-transform:none;letter-spacing:0;color:var(--faint);font-weight:500">(optional)</span></label>
        <div class="input-wrap">${I.note}<input id="title" placeholder="e.g. Work GitHub" value="${esc(e.title)}"></div></div>
      <div class="field"><label for="user">Username or email</label>
        <div class="input-wrap">${I.user}<input id="user" value="${esc(e.username)}" spellcheck="false" autocomplete="off">
          <div class="trail"><button type="button" class="icon-btn sm" id="cpu" title="Copy">${I.copy}</button></div></div></div>
      <div class="field"><label for="pw">Password</label>
        <div class="input-wrap">${I.key}<input id="pw" class="mono" type="${isNew ? 'text' : 'password'}" value="${esc(e.password)}" spellcheck="false" autocomplete="new-password">
          <div class="trail">
            <button type="button" class="icon-btn sm" id="eye" title="${isNew ? 'Hide' : 'Show'}">${isNew ? I.eyeOff : I.eye}</button>
            <button type="button" class="icon-btn sm" id="regen" title="Generate">${I.dice}</button>
            <button type="button" class="icon-btn sm" id="cpp" title="Copy">${I.copy}</button>
          </div></div>
        ${meterHTML('m')}
      </div>
      <div class="gen">
        <div class="gen-row"><span class="label" style="flex:none">Length</span><input type="range" id="len" min="8" max="64" value="${S.gen.length}"><span class="len" id="lenv">${S.gen.length}</span></div>
        <div class="chips">
          <button type="button" class="chip ${S.gen.upper ? 'on' : ''}" data-g="upper">A–Z</button>
          <button type="button" class="chip ${S.gen.digits ? 'on' : ''}" data-g="digits">0–9</button>
          <button type="button" class="chip ${S.gen.symbols ? 'on' : ''}" data-g="symbols">!@#$</button>
        </div>
      </div>
      <div class="field"><label for="notes">Notes</label>
        <div class="input-wrap"><textarea id="notes" rows="2" placeholder="Security questions, recovery codes…">${esc(e.notes)}</textarea></div></div>
      <div class="err"></div>
      <div class="row">
        ${isNew ? '' : `<button type="button" class="btn btn-danger" id="del" style="flex:none">${I.trash}</button>`}
        <button class="btn btn-primary">${isNew ? 'Save login' : 'Save changes'}</button>
      </div>
    </form>
  </section>`;

  const pw = $('#pw'), f = $('#f');
  bindMeter(pw, 'm');
  bindEye($('#eye'), pw);
  $('#back').addEventListener('click', renderList);
  $('#cpu').addEventListener('click', () => $('#user').value && copy($('#user').value, 'Username'));
  $('#cpp').addEventListener('click', () => pw.value && copy(pw.value, 'Password'));
  $('#copyAll')?.addEventListener('click', () => copy(pw.value, 'Password'));
  const regen = () => {
    pw.value = C.generatePassword(S.gen);
    pw.dispatchEvent(new Event('input'));
    Store.setSetting('gen', S.gen);
  };
  $('#regen').addEventListener('click', regen);
  $('#len').addEventListener('input', ev => { S.gen.length = +ev.target.value; $('#lenv').textContent = S.gen.length; regen(); });
  app.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
    S.gen[b.dataset.g] = !S.gen[b.dataset.g];
    b.classList.toggle('on', S.gen[b.dataset.g]);
    regen();
  }));

  const del = $('#del');
  if (del) {
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.classList.add('armed'); del.innerHTML = 'Confirm delete'; del.style.flex = '1'; setTimeout(() => { if (del.isConnected) { armed = false; del.classList.remove('armed'); del.innerHTML = I.trash; del.style.flex = 'none'; } }, 3000); return; }
      S.entries = S.entries.map(x => (x.id === entry.id ? { id: x.id, deleted: true, updated: Date.now() } : x));
      try { await persist(); } catch { return; }
      toast('Login deleted');
      renderList();
    });
  }

  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const url = $('#url').value.trim();
    const host = hostOf(url);
    if (!host) return fail(f, 'Enter a valid website, e.g. github.com');
    if (!pw.value) return fail(f, 'Password is empty.');
    const now = Date.now();
    const rec = {
      id: entry?.id || uid(),
      url, host,
      title: $('#title').value.trim(),
      username: $('#user').value.trim(),
      password: pw.value,
      notes: $('#notes').value,
      created: entry?.created || now,
      updated: now
    };
    if (isNew) S.entries.push(rec);
    else S.entries = S.entries.map(x => (x.id === rec.id ? rec : x));
    try { await persist(); } catch { return; }
    toast(isNew ? 'Login saved' : 'Changes saved');
    renderList();
  });
  setTimeout(() => (isNew && !e.url ? $('#url') : $('#user')).focus(), 50);
}

/* ---------- cards on the list view ---------- */
async function bumpStat(k) {
  const stats = (await Store.getSetting('stats', {})) || {};
  stats[k] = (stats[k] || 0) + 1;
  await Store.setSetting('stats', stats);
}

async function drawCards() {
  const box = $('#cards');
  if (!box) return;
  const [pending, stats, offerOn, tips] = await Promise.all([
    V.getPending(), Store.getSetting('stats', {}), offerEnabled(), Store.getSetting('tips', {})
  ]);
  let html = '';
  for (const p of pending) {
    html += `<div class="promo pend" data-id="${esc(p.id)}">
      <div class="avatar" style="--h:${hue(p.host)}">${esc(p.host[0])}</div>
      <div class="meta"><div class="h">${p.kind === 'update' ? 'Update password?' : 'Save this login?'}</div><div class="u">${esc((p.username ? p.username + ' · ' : '') + p.host)}</div></div>
      <button class="btn btn-primary sm" data-card="save">${p.kind === 'update' ? 'Update' : 'Save'}</button>
      <button class="icon-btn sm" data-card="drop" title="Dismiss">×</button>
    </div>`;
  }
  const uses = (stats.fills || 0) + (stats.saves || 0);
  if (!pending.length && uses >= 10 && !stats.reviewed && Date.now() > (stats.reviewLater || 0)) {
    html += `<div class="promo">
      <div class="meta"><div class="h">Enjoying Keyvane?</div><div class="u">A quick rating helps other people find it.</div></div>
      <button class="btn btn-primary sm" data-card="rate">Rate ★</button>
      <button class="icon-btn sm" data-card="later" title="Not now">×</button>
    </div>`;
  } else if (!pending.length && !offerOn && !tips.offerDismissed) {
    html += `<div class="promo">
      <div class="meta"><div class="h">Save and suggest passwords</div><div class="u">Keyvane saves logins as you sign in and suggests strong passwords on sign-up pages.</div></div>
      <button class="btn btn-primary sm" data-card="enable">Turn on</button>
      <button class="icon-btn sm" data-card="tipx" title="Dismiss">×</button>
    </div>`;
  }
  box.innerHTML = html;
}

async function onCardClick(ev) {
  const b = ev.target.closest('[data-card]');
  if (!b) return;
  const act = b.dataset.card;
  const id = b.closest('.pend')?.dataset.id;
  if (act === 'save' || act === 'drop') {
    const list = await V.getPending();
    const p = list.find(x => x.id === id);
    if (p && act === 'save') {
      const now = Date.now();
      const ex = V.findLogin(S.entries, p.host, p.username);
      if (ex) S.entries = S.entries.map(x => (x === ex ? { ...x, password: p.password, updated: now } : x));
      else S.entries.push({ id: uid(), url: p.origin || 'https://' + p.host, host: p.host, title: '', username: p.username, password: p.password, notes: '', created: now, updated: now });
      try { await persist(); } catch { return; }
      bumpStat('saves');
      toast(ex ? 'Password updated' : 'Login saved');
    }
    await V.setPending(list.filter(x => x.id !== id));
    drawResults(); drawCards();
    return;
  }
  const stats = (await Store.getSetting('stats', {})) || {};
  if (act === 'rate') { await Store.setSetting('stats', { ...stats, reviewed: true }); chrome.tabs.create({ url: REVIEW_URL }); }
  if (act === 'later') await Store.setSetting('stats', { ...stats, reviewLater: Date.now() + 14 * 864e5, fills: 0, saves: 0 });
  if (act === 'enable') return openEnableSave();
  if (act === 'tipx') { const tips = await Store.getSetting('tips', {}); await Store.setSetting('tips', { ...tips, offerDismissed: true }); }
  drawCards();
}

/* ---------- offer-to-save permission ---------- */
async function offerEnabled() {
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  return granted && S.settings.offerSave !== false;
}

// Chrome's permission dialog closes the popup, so ask from a full tab.
function openEnableSave() {
  if (!IN_TAB) return chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1#enable-save') });
  renderEnableSave();
}

function renderEnableSave() {
  S.view = 'enable';
  app.innerHTML = `
  <section class="view">
    <div class="top"><div class="brand"><div class="logo">${I.logo}</div>Keyvane</div></div>
    <div class="hero">
      <div class="hero-mark">${I.fill.replace(/currentColor/g, '#fff')}</div>
      <div>
        <h1>Save logins <span class="grad">as you sign in.</span></h1>
        <p style="margin-top:8px">When you log in, Keyvane shows a small “Save login?” card. When you create an account, it suggests a strong password and fills it in for you.</p>
      </div>
      <div class="note">${I.shield}<span>Chrome will ask to let Keyvane “read and change data on websites”. Keyvane only looks at password boxes and login forms, never sends anything anywhere, and you can turn this off in Settings at any time.</span></div>
      <button class="btn btn-primary block" id="allow">Allow and turn on</button>
      <button class="btn btn-ghost block" id="skip">Not now</button>
    </div>
  </section>`;
  $('#allow').addEventListener('click', async () => {
    const ok = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!ok) return toast('Permission not granted', 'bad');
    S.settings.offerSave = true;
    await Store.setSetting('settings', S.settings);
    app.innerHTML = `<section class="view"><div class="hero"><div class="hero-mark">${I.shield.replace(/currentColor/g, '#fff')}</div>
      <div><h1>You're all set.</h1><p style="margin-top:8px">Next time you sign in or sign up somewhere, Keyvane will help. You can close this tab.</p></div>
      <button class="btn btn-ghost block" id="done">Close tab</button></div></section>`;
    $('#done').addEventListener('click', () => window.close());
  });
  $('#skip').addEventListener('click', () => (IN_TAB ? window.close() : renderList()));
}

function bindOfferSwitch() {
  const sw = $('#offer');
  const paint = on => { sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('on', on); };
  offerEnabled().then(paint);
  Store.getSetting('neverSave', []).then(list => {
    if (!list.length) return;
    const row = $('#neverRow');
    row.classList.remove('hidden');
    row.innerHTML = `Never offered on ${list.length} site${list.length > 1 ? 's' : ''}. <a href="#" id="neverClear" style="color:var(--accent-2)">Reset</a>`;
    $('#neverClear').addEventListener('click', async e => { e.preventDefault(); await Store.setSetting('neverSave', []); row.classList.add('hidden'); toast('Reset'); });
  });
  sw.addEventListener('click', async () => {
    if (sw.getAttribute('aria-checked') === 'true') {
      S.settings.offerSave = false;
      await Store.setSetting('settings', S.settings);
      try { await chrome.permissions.remove({ origins: ['<all_urls>'] }); } catch {}
      paint(false);
      toast('Save and suggest turned off');
    } else openEnableSave();
  });
}

/* ---------- CSV import ---------- */
function openImport() {
  if (!IN_TAB) return chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1#import') });
  renderSettings();
  setTimeout(() => $('#csvBtn')?.scrollIntoView({ block: 'center' }), 50);
}

function bindCsvImport() {
  const out = $('#csvOut');
  $('#csvBtn').addEventListener('click', () => {
    // File pickers close extension popups, so do imports in a full tab.
    if (!IN_TAB) return chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1#import') });
    $('#csv').click();
  });
  $('#csv').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    const { logins, skipped, error } = V.csvToLogins(await file.text());
    if (error) { out.innerHTML = `<p class="err" style="margin-top:4px">${esc(error)}</p>`; return; }
    const have = new Set(live().map(e => `${e.host}\n${e.username || ''}\n${e.password}`));
    const fresh = [], seen = new Set();
    for (const l of logins) {
      const k = `${l.host}\n${l.username}\n${l.password}`;
      if (have.has(k) || seen.has(k)) continue;
      seen.add(k); fresh.push(l);
    }
    const dup = logins.length - fresh.length;
    out.innerHTML = `
      <div class="note" style="margin-top:2px">${I.shield}<span>Found <b>${logins.length}</b> login${logins.length === 1 ? '' : 's'} in ${esc(file.name)}${dup ? `, ${dup} already in Keyvane` : ''}${skipped ? `, ${skipped} row${skipped === 1 ? '' : 's'} without a website or password skipped` : ''}.</span></div>
      ${fresh.length ? `<button class="btn btn-primary block" id="csvGo" style="margin-top:10px">Import ${fresh.length} login${fresh.length === 1 ? '' : 's'}</button>` : ''}`;
    $('#csvGo')?.addEventListener('click', async () => {
      const now = Date.now();
      const before = S.entries;
      S.entries = [...S.entries, ...fresh.map(l => ({ id: uid(), ...l, created: now, updated: now }))];
      try { await persist(); }
      catch (e) {
        S.entries = before;
        out.innerHTML = `<p class="err">${e.code === 'QUOTA' ? "That's more than Keyvane can sync (about 1,700 logins). Import a smaller file." : "Import didn't finish. Try again."}</p>`;
        return;
      }
      out.innerHTML = `<div class="note" style="margin-top:2px">${I.shield}<span><b>Imported ${fresh.length} login${fresh.length === 1 ? '' : 's'}.</b> Now delete the CSV file: it has your passwords in plain text.</span></div>`;
      toast(`Imported ${fresh.length} login${fresh.length === 1 ? '' : 's'}`);
    });
  });
}

/* ---------- view: settings ---------- */
function renderSettings() {
  S.view = 'settings';
  const entries = live();
  const weak = entries.filter(e => C.strength(e.password).score < 2).length;
  const counts = {};
  entries.forEach(e => (counts[e.password] = (counts[e.password] || 0) + 1));
  const reused = entries.filter(e => counts[e.password] > 1).length;
  app.innerHTML = `
  <section class="view">
    <div class="top">
      <button class="icon-btn" id="back" title="Back">${I.back}</button>
      <div class="title">Settings</div>
    </div>
    <div class="scroll" style="padding-bottom:18px;max-height:500px">
      <div class="stat">
        <div><b>${entries.length}</b><span>Logins</span></div>
        <div><b style="color:${weak ? '#fbbf24' : 'var(--ok)'}">${weak}</b><span>Weak</span></div>
        <div><b style="color:${reused ? 'var(--danger)' : 'var(--ok)'}">${reused}</b><span>Reused</span></div>
      </div>

      <div class="card">
        <div class="set-row"><div><h3>Save and suggest passwords</h3><p>Keyvane shows your saved logins when you click a login box, offers to save new ones, and suggests strong passwords on sign-up pages.</p></div>
          <button class="switch" id="offer" role="switch" aria-checked="false"><i></i></button></div>
        <p id="neverRow" class="hidden" style="font-size:11.5px"></p>
      </div>

      <div class="card">
        <h3>Import passwords</h3>
        <p>From Chrome, Edge, Brave, Firefox, Safari, Bitwarden, LastPass, 1Password, Dashlane or Proton Pass: export a CSV there, then pick it here.</p>
        <button class="btn btn-ghost block" id="csvBtn">Choose CSV file</button>
        <input type="file" id="csv" accept=".csv,text/csv" class="hidden">
        <div id="csvOut"></div>
      </div>

      <div class="card">
        <div class="set-row"><div><h3>Sync</h3><p>Your encrypted vault follows your Chrome sign-in to every computer where you install Keyvane. Google only ever sees ciphertext.</p></div></div>
        <div class="meter-label"><span>Storage used</span><span id="use">…</span></div>
        <div class="usebar"><i id="usebar"></i></div>
        <p style="font-size:11px">Needs Chrome sync on (Settings → You and Google → Sync → Extensions). Without it, the vault stays on this device only.</p>
      </div>

      <div class="card">
        <div class="set-row"><div><h3>Auto-lock</h3><p>Lock after inactivity. Always locks when Chrome closes.</p></div>
          <select id="al" style="width:auto">
            ${[[1, '1 min'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour'], [0, 'Browser close']].map(([v, l]) => `<option value="${v}" ${S.settings.autoLock === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
      </div>

      <form class="card" id="cpw" autocomplete="off">
        <h3>Change master password</h3>
        <div class="input-wrap"><input id="old" type="password" placeholder="Current master password"></div>
        <div class="input-wrap"><input id="n1" type="password" placeholder="New master password"></div>
        ${meterHTML('m')}
        <div class="input-wrap"><input id="n2" type="password" placeholder="Confirm new password"></div>
        <div class="err"></div>
        <button class="btn btn-ghost block">Re-encrypt vault</button>
      </form>

      <div class="card">
        <h3>Backup</h3>
        <p>Exports the <b>encrypted</b> vault as a file. It can only be opened with the master password used when exported.</p>
        <div class="row">
          <button class="btn btn-ghost" id="exp">Export</button>
          <button class="btn btn-ghost" id="imp">Import</button>
        </div>
        <input type="file" id="file" accept="application/json,.json" class="hidden">
      </div>

      <div class="card">
        <h3>Danger zone</h3>
        <p>Permanently erase the vault from this browser.</p>
        <button class="btn btn-danger block" id="wipe">Erase vault</button>
      </div>
      <p style="text-align:center;color:var(--faint);font-size:11px">Keyvane 1.4 · end-to-end encrypted · free</p>
    </div>
  </section>`;

  $('#back').addEventListener('click', renderList);
  bindOfferSwitch();
  bindCsvImport();
  Store.usage().then(b => {
    const pct = Math.min(100, Math.round((b / Store.QUOTA) * 100));
    if ($('#use')) { $('#use').textContent = `${(b / 1024).toFixed(1)} KB of ${Math.round(Store.QUOTA / 1024)} KB · ${pct}%`; $('#usebar').style.width = pct + '%'; }
  });
  $('#al').addEventListener('change', async ev => {
    S.settings.autoLock = +ev.target.value;
    await Store.setSetting('settings', S.settings);
    await touch();
    toast('Auto-lock updated');
  });

  const n1 = $('#n1');
  bindMeter(n1, 'm');
  $('#cpw').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const vault = await getVault();
    const oldKey = await C.deriveKey($('#old').value, C.unb64(vault.salt), vault.iter);
    try { await C.decryptJSON(oldKey, vault); } catch { return fail(f, 'Current password is wrong.'); }
    if (n1.value.length < 8) return fail(f, 'Use at least 8 characters.');
    if (n1.value !== $('#n2').value) return fail(f, "New passwords don't match.");
    const salt = C.randomBytes(16);
    const key = await C.deriveKey(n1.value, salt, C.DEFAULT_ITERATIONS);
    const blob = await C.encryptJSON(key, { entries: S.entries });
    const updated = Date.now();
    saving = true;
    await Store.writeVault({ ...vault, salt: C.b64(salt), iter: C.DEFAULT_ITERATIONS, ...blob, updated });
    setTimeout(() => (saving = false), 300);
    await openSession(key, S.entries, updated, C.b64(salt));
    toast('Master password changed');
    renderSettings();
  });

  $('#exp').addEventListener('click', async () => {
    const { partial, n, len, ...vault } = await getVault();
    const data = JSON.stringify({ app: 'keyvane', format: 2, exported: new Date().toISOString(), vault }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `keyvane-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Encrypted backup exported');
  });

  $('#imp').addEventListener('click', () => {
    // File pickers close extension popups, so do imports in a full tab.
    if (!IN_TAB) return chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1#settings') });
    $('#file').click();
  });
  $('#file').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const v = parsed.vault;
      if (!['vaultline', 'keyvane'].includes(parsed.app) || !v?.salt || !v?.iv || !v?.ct || !v?.iter) throw 0;
      await Store.writeVault({ ...v, v: 2, z: v.z || 0, updated: Date.now() });
      await session.remove(['key', 'lastActive']);
      S.key = null; S.entries = [];
      renderUnlock();
      toast("Imported — unlock with the backup's password");
    } catch { toast('Not a valid Keyvane backup', 'bad'); }
  });

  const wipe = $('#wipe');
  let armed = false;
  wipe.addEventListener('click', async () => {
    if (!armed) { armed = true; wipe.classList.add('armed'); wipe.textContent = 'Click again to erase everything'; setTimeout(() => { if (wipe.isConnected) { armed = false; wipe.classList.remove('armed'); wipe.textContent = 'Erase vault'; } }, 3500); return; }
    await Store.eraseVault();
    await session.remove(['key', 'lastActive']);
    S.key = null; S.entries = [];
    toast('Vault erased');
    renderSetup();
  });
}

/* ---------- boot ---------- */
(async function boot() {
  const stored = await chrome.storage.sync.get(['settings', 'gen']);
  if (stored.settings) S.settings = { ...S.settings, ...stored.settings };
  if (stored.gen) S.gen = { ...S.gen, ...stored.gen };

  if (!IN_TAB) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      S.tab = tab || null;
      S.tabHost = hostOf(tab?.url || '');
      if (!S.tabHost) S.tab = null;
    } catch {}
  }

  if (!(await getVault())) return renderSetup();
  if (await restoreSession()) {
    if (location.hash === '#settings' || location.hash === '#import') { renderSettings(); if (location.hash === '#import') setTimeout(() => $('#csvBtn')?.scrollIntoView({ block: 'center' }), 50); return; }
    if (location.hash === '#enable-save') return renderEnableSave();
    return renderList();
  }
  renderUnlock();
})();

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.key && !app.querySelector('#q')) { e.preventDefault(); renderList(); }
});
