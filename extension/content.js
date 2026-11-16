// Keyvane: offers to save logins when you sign in, and suggests strong
// passwords when you create one.
// The password goes only to Keyvane's own background worker; the page never
// sees anything from Keyvane except the small banner below.
(() => {
  if (window.__keyvaneCapture) return;
  window.__keyvaneCapture = true;

  const send = msg => { try { return chrome.runtime.sendMessage(msg); } catch { return Promise.resolve({}); } };
  const TEXTY = ['text', 'email', 'tel', ''];
  const userLike = i => TEXTY.includes((i.getAttribute('type') || '').toLowerCase()) &&
    (i.type === 'email' || /user|login|email|mail|account|ident|phone/i.test(`${i.name} ${i.id} ${i.autocomplete} ${i.placeholder} ${i.getAttribute('aria-label') || ''}`));

  function grab(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    let pws = [...root.querySelectorAll('input[type=password]')].filter(i => i.value && !/one-time-code/i.test(i.autocomplete));
    if (!pws.length && root !== document) pws = [...document.querySelectorAll('input[type=password]')].filter(i => i.value);
    if (!pws.length) return null;
    // Change-password forms: current, new, confirm -> keep the new one.
    const pw = pws.length >= 3 ? pws[1] : pws.length === 2 && pws[0].value !== pws[1].value ? pws[1] : pws[0];
    const inputs = [...document.querySelectorAll('input')];
    let username = '';
    const before = inputs.slice(0, inputs.indexOf(pws[0])).reverse()
      .filter(el => el.value && TEXTY.includes((el.getAttribute('type') || '').toLowerCase()));
    const best = before.find(userLike) || before[0];
    if (best) username = best.value.trim();
    return { username, password: pw.value };
  }

  let last = '';
  function capture(scope) {
    const c = grab(scope);
    if (!c || c.password.length < 3) return;
    const sig = c.username + '\u0000' + c.password;
    if (sig === last) return;
    last = sig;
    send({ type: 'kv-capture', url: location.href, ...c });
  }

  document.addEventListener('submit', e => capture(e.target), true);
  document.addEventListener('click', e => {
    const b = e.target.closest?.('button, input[type=submit], input[type=button], [role=button]');
    if (b) capture(b.closest('form'));
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target?.matches?.('input')) capture(e.target.form);
  }, true);
  // Remember the email typed on step one of two-step logins (Google, Microsoft…).
  document.addEventListener('change', e => {
    const t = e.target;
    if (t?.matches?.('input') && t.value && userLike(t)) send({ type: 'kv-hint', username: t.value.trim(), url: location.href });
  }, true);

  /* ---------- strong password suggestions ---------- */
  const SETS = { lower: 'abcdefghijkmnopqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits: '23456789', symbols: '!@#$%^&*()-_=+[]{};:,.?/~' };
  const rand = n => { const max = Math.floor(0x100000000 / n) * n, b = new Uint32Array(1); do crypto.getRandomValues(b); while (b[0] >= max); return b[0] % n; };
  async function strongPassword() {
    let g = { length: 20, upper: true, digits: true, symbols: true };
    try { const { gen } = await chrome.storage.sync.get('gen'); if (gen) g = { ...g, ...gen }; } catch {}
    const pools = [SETS.lower];
    if (g.upper) pools.push(SETS.upper);
    if (g.digits) pools.push(SETS.digits);
    if (g.symbols) pools.push(SETS.symbols);
    const all = pools.join(''), len = Math.max(12, Math.min(64, g.length | 0 || 20));
    const c = pools.map(p => p[rand(p.length)]);
    while (c.length < len) c.push(all[rand(all.length)]);
    for (let i = c.length - 1; i > 0; i--) { const j = rand(i + 1); [c[i], c[j]] = [c[j], c[i]]; }
    return c.join('');
  }

  const NEW_WORDS = /sign ?up|register|create|join|get started|new password|change password|reset password|set (a |your )?password|choose (a )?password/i;
  const LOGIN_WORDS = /log ?in|sign ?in/i;
  const submitText = form => {
    const b = form?.querySelector('button[type=submit], input[type=submit], button:not([type])');
    return b ? (b.innerText || b.value || '').trim() : '';
  };
  // Is this a box for choosing a NEW password (sign-up, change or reset), not logging in?
  function isNewPassword(el) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'password' || el.readOnly || el.disabled) return false;
    const ac = (el.autocomplete || '').toLowerCase();
    if (ac.includes('current-password')) return false;
    if (ac.includes('new-password')) return true;
    if (/new|confirm|repeat|retype|again|create|choose|regist|sign_?up/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`)) return true;
    const scope = el.form || document;
    if (scope.querySelectorAll('input[type=password]').length >= 2) return true;
    const btn = submitText(el.form);
    if (btn) return NEW_WORDS.test(btn) && !LOGIN_WORDS.test(btn);
    const heading = document.querySelector('h1, h2')?.innerText || document.title;
    return NEW_WORDS.test(heading) && !LOGIN_WORDS.test(heading);
  }

  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Fill the chosen field and its "confirm password" twin, never the current-password box.
  function fillNewPassword(el, pw) {
    const all = [...(el.form || document).querySelectorAll('input[type=password]')];
    const targets = all.filter((f, i) => f === el || (isNewPassword(f) && !(all.length >= 3 && i === 0 && el !== all[0])));
    targets.forEach(f => setVal(f, pw));
    el.focus();
  }

  const dismissed = new WeakSet();
  let chip = null, chipFor = null;
  const hideChip = () => { document.querySelectorAll('keyvane-suggest').forEach(n => n.remove()); chip = null; chipFor = null; };

  async function showChip(el) {
    if (chipFor === el) return; // already showing, or being built, for this box
    hideChip();
    chipFor = el;
    const pw = await strongPassword();
    if (chipFor !== el || document.activeElement !== el || el.value || chip) { if (chipFor === el && !chip) chipFor = null; return; }
    const r = el.getBoundingClientRect();
    chip = document.createElement('keyvane-suggest');
    const top = r.bottom + 64 > innerHeight ? r.top - 60 : r.bottom + 6;
    chip.style.cssText = `all:initial;position:fixed;z-index:2147483647;left:${Math.max(8, Math.min(r.left, innerWidth - 336))}px;top:${Math.max(8, top)}px;`;
    const root = chip.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .w{display:flex;align-items:stretch;gap:2px;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;color:#eef0f7;
           background:rgba(12,13,20,.96);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:4px;width:320px;box-sizing:border-box;
           box-shadow:0 18px 40px -12px rgba(0,0,0,.6),0 0 0 1px rgba(139,92,246,.25);animation:in .18s ease-out}
        @keyframes in{from{opacity:0;transform:translateY(-4px)}}
        button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;border-radius:9px}
        .s{flex:1;min-width:0;display:flex;gap:10px;align-items:center;text-align:left;padding:7px 8px}
        .s:hover,.s:focus-visible{background:rgba(139,92,246,.18);outline:none}
        .logo{width:26px;height:26px;border-radius:8px;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}
        .t{min-width:0;display:grid}
        b{font-weight:650;font-size:13px}
        code{font:12px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#a5b4fc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .x{width:28px;color:#8b90a6;font-size:17px}
        .x:hover{color:#fff;background:rgba(255,255,255,.08)}
      </style>
      <div class="w" role="dialog" aria-label="Keyvane password suggestion">
        <button class="s" type="button">
          <span class="logo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
          <span class="t"><b>Use a strong password</b><code></code></span>
        </button>
        <button class="x" type="button" title="Not now" aria-label="Not now">×</button>
      </div>`;
    root.querySelector('code').textContent = pw;
    const keep = e => e.preventDefault(); // keep focus in the password box
    root.querySelector('.s').addEventListener('mousedown', keep);
    root.querySelector('.x').addEventListener('mousedown', keep);
    root.querySelector('.s').addEventListener('click', () => { fillNewPassword(el, pw); hideChip(); });
    root.querySelector('.x').addEventListener('click', () => { dismissed.add(el); hideChip(); });
    document.documentElement.appendChild(chip);
  }

  /* ---------- login menu: saved logins under the login box ---------- */
  const scopeOf = el => el.form || document;
  const loginPassword = scope => [...scope.querySelectorAll('input[type=password]')].find(f => !isNewPassword(f) && !f.disabled);
  // A box worth offering saved logins for: a login password box, or a username box next to one
  // (or marked as a username, for two-step logins).
  function isLoginField(el) {
    if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly) return false;
    if (el.type === 'password') return !isNewPassword(el);
    if (!userLike(el)) return false;
    const pw = [...scopeOf(el).querySelectorAll('input[type=password]')];
    if (pw.length) return pw.some(f => !isNewPassword(f));
    return /username|email/i.test(el.autocomplete || '') || !!el.form;
  }

  function fillLogin(el, cred) {
    const scope = scopeOf(el);
    const pw = el.type === 'password' ? el : loginPassword(scope);
    let user = el.type !== 'password' ? el : null;
    if (!user) {
      const inputs = [...scope.querySelectorAll('input')];
      const before = inputs.slice(0, inputs.indexOf(pw)).reverse().filter(i => TEXTY.includes((i.getAttribute('type') || '').toLowerCase()) && !i.disabled && !i.readOnly);
      user = before.find(userLike) || before[0] || null;
    }
    if (user && cred.username) setVal(user, cred.username);
    if (pw && cred.password) setVal(pw, cred.password);
    (pw || user)?.focus();
  }

  let menu = null, menuFor = null, menuItems = [], menuIdx = -1, menuReq = 0;
  const hideMenu = () => { document.querySelectorAll('keyvane-menu').forEach(n => n.remove()); menu = null; menuFor = null; menuItems = []; menuIdx = -1; };
  const closedFor = new WeakSet();

  async function showMenu(el, force) {
    if (!force && menuFor === el) return;
    hideMenu();
    menuFor = el;
    const req = ++menuReq;
    const r = (await send({ type: 'kv-logins?' })) || {};
    if (req !== menuReq || menuFor !== el || document.activeElement !== el) return;
    if (!r.locked && !(r.logins || []).length) { menuFor = null; return; }
    hideChip();
    const box = el.getBoundingClientRect();
    menu = document.createElement('keyvane-menu');
    const rows = r.locked ? 1 : Math.min(r.logins.length, 4);
    const est = 22 + rows * 46;
    const top = box.bottom + est + 8 > innerHeight && box.top - est - 6 > 0 ? box.top - est - 6 : box.bottom + 6;
    menu.style.cssText = `all:initial;position:fixed;z-index:2147483647;left:${Math.max(8, Math.min(box.left, innerWidth - 316))}px;top:${Math.max(8, top)}px;`;
    const root = menu.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .w{font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;color:#eef0f7;width:300px;box-sizing:border-box;
           background:rgba(12,13,20,.97);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:5px;
           box-shadow:0 18px 40px -12px rgba(0,0,0,.6),0 0 0 1px rgba(139,92,246,.25);animation:in .16s ease-out}
        @keyframes in{from{opacity:0;transform:translateY(-4px)}}
        .hd{display:flex;align-items:center;gap:7px;padding:4px 7px 6px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#8b90a6}
        .lg{width:16px;height:16px;border-radius:5px;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}
        .x{margin-left:auto;background:none;border:0;color:#8b90a6;font-size:15px;line-height:1;cursor:pointer;padding:0 3px;border-radius:5px}
        .x:hover{color:#fff}
        .list{max-height:190px;overflow-y:auto;display:grid;gap:2px}
        .it{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;color:inherit;background:none;border:0;border-radius:9px;padding:7px 8px;cursor:pointer}
        .it:hover,.it.on{background:rgba(139,92,246,.2)}
        .av{width:28px;height:28px;border-radius:8px;flex:none;display:grid;place-items:center;font-weight:700;font-size:12.5px;color:#fff;text-transform:uppercase}
        .m{min-width:0;display:grid}
        .m b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .m span{font-size:12px;color:#9a9fb5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      </style>
      <div class="w" role="listbox" aria-label="Keyvane saved logins">
        <div class="hd"><span class="lg"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>Keyvane<button class="x" type="button" title="Close" aria-label="Close">×</button></div>
        <div class="list"></div>
      </div>`;
    const list = root.querySelector('.list');
    const keep = e => e.preventDefault();
    root.querySelector('.x').addEventListener('mousedown', keep);
    root.querySelector('.x').addEventListener('click', () => { closedFor.add(el); hideMenu(); });
    const item = (avatar, hue, title, sub, onPick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'it'; b.setAttribute('role', 'option');
      b.innerHTML = `<span class="av"></span><span class="m"><b></b><span></span></span>`;
      const av = b.querySelector('.av'); av.textContent = avatar;
      av.style.background = hue == null ? 'linear-gradient(135deg,#8b5cf6,#22d3ee)' : `linear-gradient(135deg,hsl(${hue} 75% 60%),hsl(${hue + 45} 80% 48%))`;
      b.querySelector('b').textContent = title; b.querySelector('.m span').textContent = sub;
      b.addEventListener('mousedown', keep);
      b.addEventListener('click', onPick);
      list.appendChild(b);
      menuItems.push(b);
    };
    if (r.locked) {
      item('🔒', null, 'Unlock Keyvane', 'to fill your saved login', async () => { hideMenu(); await send({ type: 'kv-unlock' }); });
    } else {
      const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
      for (const l of r.logins) {
        const name = l.username || '(no username)';
        item((l.title || '?')[0], hue(l.title || ''), name, l.title, async () => {
          hideMenu();
          const c = (await send({ type: 'kv-fill', id: l.id })) || {};
          if (c.locked) return showMenu(el, true);
          if (c.password != null) fillLogin(el, c);
        });
      }
    }
    document.documentElement.appendChild(menu);
  }

  const maybeMenu = t => { if (!closedFor.has(t) && isLoginField(t) && !(t.type === 'password' && t.value)) showMenu(t); };
  document.addEventListener('focusin', e => maybeMenu(e.target), true);
  document.addEventListener('click', e => { if (e.target === document.activeElement && e.target !== menuFor) maybeMenu(e.target); }, true);
  document.addEventListener('focusout', e => { if (e.target === menuFor) setTimeout(() => { if (document.activeElement !== menuFor) hideMenu(); }, 150); }, true);
  document.addEventListener('input', e => { if (e.target === menuFor && e.target.type === 'password' && e.target.value) hideMenu(); }, true);
  document.addEventListener('keydown', e => {
    if (!menu || e.target !== menuFor) return;
    const n = menuItems.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      menuIdx = (menuIdx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      menuItems.forEach((b, i) => b.classList.toggle('on', i === menuIdx));
      menuItems[menuIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && menuIdx >= 0) {
      e.preventDefault(); e.stopPropagation(); menuItems[menuIdx].click();
    } else if (e.key === 'Escape') {
      closedFor.add(menuFor); hideMenu();
    }
  }, true);
  addEventListener('scroll', () => menu && hideMenu(), true);
  addEventListener('resize', () => menu && hideMenu());
  chrome.runtime.onMessage.addListener(m => {
    if (m?.type === 'kv-unlocked' && document.activeElement && isLoginField(document.activeElement)) {
      closedFor.delete(document.activeElement); showMenu(document.activeElement, true);
    }
  });

  const maybeSuggest = t => { if (isNewPassword(t) && !t.value && !dismissed.has(t)) showChip(t); };
  document.addEventListener('focusin', e => maybeSuggest(e.target), true);
  document.addEventListener('click', e => { if (e.target === document.activeElement) maybeSuggest(e.target); }, true);
  document.addEventListener('input', e => { if (e.target === chipFor && e.target.value) hideChip(); }, true);
  document.addEventListener('focusout', e => { if (e.target === chipFor) setTimeout(() => { if (document.activeElement !== chipFor) hideChip(); }, 120); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chip) { if (chipFor) dismissed.add(chipFor); hideChip(); } }, true);
  addEventListener('scroll', () => chip && hideChip(), true);
  addEventListener('resize', () => chip && hideChip());

  /* ---------- banner ---------- */
  let host;
  function banner(p) {
    if (host?.isConnected) return;
    send({ type: 'kv-shown', id: p.id });
    host = document.createElement('keyvane-offer');
    host.style.cssText = 'all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const verb = p.kind === 'update' ? 'Update password' : 'Save login';
    root.innerHTML = `
      <style>
        .card{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;color:#eef0f7;width:320px;
          background:rgba(12,13,20,.94);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);border-radius:16px;
          box-shadow:0 24px 60px -16px rgba(0,0,0,.6),0 0 0 1px rgba(139,92,246,.25);padding:14px;display:grid;gap:12px;
          animation:in .25s cubic-bezier(.2,.8,.2,1)}
        @keyframes in{from{opacity:0;transform:translateY(-8px)}}
        .top{display:flex;gap:10px;align-items:center}
        .logo{width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}
        .t{font-weight:650;font-size:13.5px}.s{color:#9a9fb5;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
        .x{margin-left:auto;align-self:flex-start;background:none;border:0;color:#8b90a6;font-size:18px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:6px}
        .x:hover{color:#fff;background:rgba(255,255,255,.08)}
        .row{display:flex;gap:8px}
        button.b{font:inherit;font-weight:600;border-radius:10px;height:34px;padding:0 12px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#eef0f7}
        button.b:hover{background:rgba(255,255,255,.1)}
        button.p{flex:1;border:0;color:#fff;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}
        button.p:hover{filter:brightness(1.08)}
        .msg{color:#cfd3e3}
      </style>
      <div class="card" role="dialog" aria-label="Keyvane">
        <div class="top">
          <div class="logo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>
          <div><div class="t">${verb} in Keyvane?</div><div class="s"></div></div>
          <button class="x" title="Close" aria-label="Close">×</button>
        </div>
        <div class="row"><button class="b p save">${verb}</button><button class="b never">Never here</button></div>
      </div>`;
    root.querySelector('.s').textContent = (p.username ? p.username + ' · ' : '') + p.host;
    const close = () => { host.remove(); };
    const say = (text, ms = 2600) => {
      root.querySelector('.row').innerHTML = '';
      const m = document.createElement('div'); m.className = 'msg'; m.textContent = text;
      root.querySelector('.row').appendChild(m);
      setTimeout(close, ms);
    };
    root.querySelector('.x').onclick = () => { send({ type: 'kv-dismiss', id: p.id }); close(); };
    root.querySelector('.never').onclick = () => { send({ type: 'kv-never', id: p.id }); say(`Keyvane won't offer to save on ${p.host}.`); };
    root.querySelector('.save').onclick = async () => {
      const r = (await send({ type: 'kv-save', id: p.id })) || {};
      if (r.result === 'saved') say('Saved to Keyvane ✓');
      else if (r.result === 'updated') say('Password updated in Keyvane ✓');
      else if (r.result === 'locked') say('Keyvane is locked. Click the Keyvane icon in the toolbar and unlock to finish saving.', 7000);
      else if (r.result === 'full') say('Keyvane is full. Remove some logins and try again.', 5000);
      else if (r.result === 'syncing') say('Keyvane is syncing. Open Keyvane in a moment to finish saving.', 5000);
      else say('Could not save. Open Keyvane to finish.', 4000);
    };
    (document.body || document.documentElement).appendChild(host);
    setTimeout(() => { if (host?.isConnected) close(); }, 45000);
  }

  chrome.runtime.onMessage.addListener(m => { if (m?.type === 'kv-offer' && m.pending) banner(m.pending); });
  send({ type: 'kv-pending?' }).then(r => { if (r?.pending) banner(r.pending); }).catch(() => {});
})();
