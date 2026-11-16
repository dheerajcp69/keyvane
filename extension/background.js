// Keyvane background worker: offers to save logins you type into websites.
// Runs only after the user turns on "Offer to save passwords" (optional permission).
import * as V from './vaultops.js';

const SCRIPT_ID = 'keyvane-capture';
const ALL = { origins: ['<all_urls>'] };

async function syncCaptureScript() {
  const granted = await chrome.permissions.contains(ALL);
  const { settings } = await chrome.storage.sync.get('settings');
  const on = granted && settings?.offerSave !== false;
  const reg = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (on && !reg.length) {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID, matches: ['http://*/*', 'https://*/*'], js: ['content.js'],
      runAt: 'document_idle', allFrames: false, persistAcrossSessions: true
    }]);
  } else if (!on && reg.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
}

chrome.runtime.onInstalled.addListener(syncCaptureScript);
chrome.runtime.onStartup.addListener(syncCaptureScript);
chrome.permissions.onAdded.addListener(syncCaptureScript);
chrome.permissions.onRemoved.addListener(syncCaptureScript);
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && ch.settings) syncCaptureScript(); });

const publicView = p => ({ id: p.id, host: p.host, username: p.username, kind: p.kind });

async function onCapture(msg, tab) {
  const host = V.hostOf(msg.url);
  if (!host || !msg.password || msg.password.length < 3) return;
  const { neverSave = [] } = await chrome.storage.sync.get('neverSave');
  if (neverSave.includes(host)) return;

  let username = (msg.username || '').trim();
  if (!username) {
    const { hints = {} } = await chrome.storage.session.get('hints');
    const h = hints[tab.id];
    if (h && Date.now() - h.ts < 10 * 60e3 && V.siteMatch(V.hostOf(h.url), host)) username = h.username;
  }

  // Already saved with this password? Then stay quiet.
  let status = 'unknown';
  const key = await V.getSessionKey();
  if (key) {
    try {
      const { entries } = await V.readEntries(key);
      const ex = V.findLogin(entries, host, username);
      status = !ex ? 'new' : ex.password === msg.password ? 'same' : 'changed';
    } catch {}
  }
  if (status === 'unknown') status = await V.checkKnown(host, username, msg.password);
  if (status === 'same') return;

  const list = (await V.getPending()).filter(p => !(p.host === host && p.username === username));
  const p = { id: V.uid(), tabId: tab.id, host, origin: V.originOf(msg.url), username, password: msg.password, kind: status === 'changed' ? 'update' : 'save', ts: Date.now() };
  list.push(p);
  await V.setPending(list);

  // Single-page logins never reload, so also offer right away in the same page.
  setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: 'kv-offer', pending: publicView(p) }).catch(() => {}), 1200);
}

async function handle(msg, sender) {
  const tab = sender.tab;
  switch (msg.type) {
    case 'kv-capture':
      if (tab) await onCapture(msg, tab);
      return {};
    case 'kv-hint': {
      if (!tab || !msg.username) return {};
      const { hints = {} } = await chrome.storage.session.get('hints');
      hints[tab.id] = { username: msg.username, url: msg.url, ts: Date.now() };
      await chrome.storage.session.set({ hints });
      return {};
    }
    case 'kv-pending?': {
      if (!tab) return {};
      const p = (await V.getPending()).filter(x => x.tabId === tab.id && Date.now() - x.ts < 3 * 60e3 && !x.shown).pop();
      if (!p) return {};
      return { pending: publicView(p) };
    }
    case 'kv-shown': {
      const list = await V.getPending();
      list.forEach(p => { if (p.id === msg.id) p.shown = true; });
      await chrome.storage.session.set({ pending: list });
      return {};
    }
    case 'kv-save': {
      const list = await V.getPending();
      const p = list.find(x => x.id === msg.id);
      if (!p) return { result: 'gone' };
      const key = await V.getSessionKey();
      if (!key) return { result: 'locked' };
      try {
        const r = await V.upsertLogin(key, p);
        await V.setPending(list.filter(x => x.id !== p.id));
        return { result: r };
      } catch (e) {
        return { result: e.code === 'QUOTA' ? 'full' : e.code === 'SYNCING' ? 'syncing' : 'error' };
      }
    }
    case 'kv-logins?': {
      // Only the top frame, and only logins for the page's own site.
      if (!tab || sender.frameId !== 0) return {};
      const host = V.hostOf(sender.url || tab.url);
      if (!host) return {};
      const key = await V.getSessionKey();
      if (!key) return { locked: true };
      try {
        const { entries } = await V.readEntries(key);
        return { logins: entries.filter(e => !e.deleted && V.siteMatch(e.host, host))
          .sort((x, y) => (y.updated || 0) - (x.updated || 0))
          .map(e => ({ id: e.id, username: e.username || '', title: e.title || e.host })) };
      } catch { return {}; }
    }
    case 'kv-fill': {
      if (!tab || sender.frameId !== 0) return {};
      const key = await V.getSessionKey();
      if (!key) return { locked: true };
      try {
        const { entries } = await V.readEntries(key);
        const e = entries.find(x => x.id === msg.id && !x.deleted);
        // Re-check the site here, from Chrome's own record of the page, never the page's word.
        if (!e || !V.siteMatch(e.host, V.hostOf(sender.url || tab.url))) return {};
        await chrome.storage.session.set({ lastActive: Date.now() });
        const { stats = {} } = await chrome.storage.sync.get('stats');
        await chrome.storage.sync.set({ stats: { ...stats, fills: (stats.fills || 0) + 1 } });
        return { username: e.username || '', password: e.password };
      } catch { return {}; }
    }
    case 'kv-unlock': {
      if (!tab) return {};
      await chrome.storage.session.set({ unlockTab: tab.id });
      try { await chrome.action.openPopup({ windowId: tab.windowId }); return { opened: 'popup' }; }
      catch {
        await chrome.windows.create({ url: chrome.runtime.getURL('popup.html?unlock=1'), type: 'popup', width: 400, height: 640, focused: true });
        return { opened: 'window' };
      }
    }
    case 'kv-dismiss':
    case 'kv-never': {
      const list = await V.getPending();
      const p = list.find(x => x.id === msg.id);
      await V.setPending(list.filter(x => x.id !== msg.id));
      if (msg.type === 'kv-never' && p) {
        const { neverSave = [] } = await chrome.storage.sync.get('neverSave');
        if (!neverSave.includes(p.host)) await chrome.storage.sync.set({ neverSave: [...neverSave, p.host] });
      }
      return {};
    }
  }
  return {};
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg?.type?.startsWith('kv-') || sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then(reply, () => reply({}));
  return true;
});

// After the user unlocks from a page's login menu, reopen the menu on that page.
chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area !== 'session' || !ch.key?.newValue) return;
  const { unlockTab } = await chrome.storage.session.get('unlockTab');
  if (unlockTab == null) return;
  await chrome.storage.session.remove('unlockTab');
  chrome.tabs.sendMessage(unlockTab, { type: 'kv-unlocked' }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const { hints } = await chrome.storage.session.get('hints');
  if (hints?.[tabId]) { delete hints[tabId]; await chrome.storage.session.set({ hints }); }
});
