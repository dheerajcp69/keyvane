// Keyvane: offers to save logins when you sign in, and suggests strong
// passwords when you create one.
// The password goes only to Keyvane's own background worker; the page never
// sees anything from Keyvane except the small banner below.

(() => {
  if (window.__keyvaneCapture) return;
  window.__keyvaneCapture = true;

  // 1.5 holographic skin shared by the in-page chip, menu and save card.
  const HOLO = `
    .w,.card{border:1px solid transparent!important;
      background:linear-gradient(rgba(10,11,20,.97),rgba(10,11,20,.97)) padding-box,
        linear-gradient(135deg,rgba(167,139,250,.75),rgba(34,211,238,.25) 45%,rgba(255,255,255,.06) 70%,rgba(34,211,238,.6)) border-box!important;
      box-shadow:0 22px 50px -14px rgba(0,0,0,.7),0 0 34px -10px rgba(139,92,246,.75),0 0 22px -12px rgba(34,211,238,.8)!important;
      animation:holoIn .32s cubic-bezier(.2,.8,.2,1)!important;transform-origin:top left}
    @keyframes holoIn{from{opacity:0;transform:translateY(-6px) scale(.97);filter:blur(3px)}}
    .logo,.lg{box-shadow:0 0 14px -2px rgba(139,92,246,.9),inset 0 1px 0 rgba(255,255,255,.3)}
    .hd{font-family:ui-monospace,Menlo,Consolas,monospace!important;letter-spacing:.14em!important;color:#67e8f9!important}
    .it:hover,.it.on,.s:hover,.s:focus-visible{background:linear-gradient(90deg,rgba(139,92,246,.26),rgba(34,211,238,.1))!important;box-shadow:inset 2px 0 0 #22d3ee}
    button.p{background:linear-gradient(110deg,#7c3aed,#6366f1 35%,#06b6d4 70%,#7c3aed) 0 0/220% 100%!important;animation:flow 6s linear infinite;
      box-shadow:0 8px 22px -8px rgba(139,92,246,.95),0 0 18px -6px rgba(34,211,238,.7)}
    @keyframes flow{to{background-position:220% 0}}
    code{color:#67e8f9!important;text-shadow:0 0 10px rgba(34,211,238,.45)}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}
  `;

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
        ${HOLO}
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
    const cond = pkCond;
    const [r, pk] = await Promise.all([send({ type: 'kv-logins?' }).then(x => x || {}),
      cond ? send({ type: 'kv-pk-list', opts: cond.opts }).then(x => x || {}) : {}]);
    if (req !== menuReq || menuFor !== el || document.activeElement !== el) return;
    const pkItems = cond === pkCond ? pk.items || [] : [];
    if (!r.locked && !(r.logins || []).length && !pkItems.length) { menuFor = null; return; }
    hideChip();
    const box = el.getBoundingClientRect();
    menu = document.createElement('keyvane-menu');
    const rows = r.locked ? 1 : Math.min((r.logins || []).length + pkItems.length, 4);
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
        .it.pk .m span{color:#67e8f9}
        ${HOLO}
      </style>
      <div class="w" role="listbox" aria-label="Keyvane saved logins">
        <div class="hd"><span class="lg"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>Keyvane<button class="x" type="button" title="Close" aria-label="Close">×</button></div>
        <div class="list"></div>
      </div>`;
    const list = root.querySelector('.list');
    const keep = e => e.preventDefault();
    root.querySelector('.x').addEventListener('mousedown', keep);
    root.querySelector('.x').addEventListener('click', () => { closedFor.add(el); hideMenu(); });
    const item = (avatar, hue, title, sub, onPick, cls) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'it' + (cls ? ' ' + cls : ''); b.setAttribute('role', 'option');
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
      for (const k of pkItems) {
        item('⚿', null, k.username || '(no username)', 'Passkey' + (k.title ? ' · ' + k.title : ''), async () => {
          hideMenu();
          if (!pkCond) return;
          const id = pkCond.id, opts = pkCond.opts;
          const c = (await send({ type: 'kv-pk-get', opts, entryId: k.id })) || {};
          if (c.locked) return showMenu(el, true);
          if (c.cred && pkCond?.id === id) { pkCond = null; pkReply(id, { status: 'ok', cred: c.cred }); }
        }, 'pk');
      }
      for (const l of r.logins || []) {
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


  /* ---------- passkeys ---------- */
  // Requests come from Keyvane's page script (pk-page.js) for this page only; the background
  // worker checks the website against Chrome's own record of the tab before using any key.
  let pkCond = null;   // an open "autofill passkey" request: { id, opts }
  let pkDlg = null;    // the open passkey dialog: { id, el, refresh }
  const pkReply = (id, m) => window.postMessage({ __kv: 'pk-res', id, ...m }, location.origin);
  const closeDlg = () => { document.querySelectorAll('keyvane-passkey').forEach(n => n.remove()); pkDlg = null; };

  addEventListener('message', ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d.__kv !== 'pk-req' || typeof d.id !== 'string') return;
    if (d.op === 'cancel') {
      if (pkCond?.id === d.id) pkCond = null;
      if (pkDlg?.id === d.id) closeDlg();
      return;
    }
    if (d.op === 'create') pkCreate(d.id, d.payload || {});
    else if (d.op === 'get') pkGet(d.id, d.payload || {});
    else if (d.op === 'conditional') pkConditional(d.id, d.payload || {});
  });

  async function pkConditional(id, opts) {
    const r = (await send({ type: 'kv-pk-list', opts })) || {};
    if (r.bad || (!r.locked && !(r.items || []).length)) return pkReply(id, { status: 'fallback' });
    pkCond = { id, opts };
    pkReply(id, { status: 'listening' });
    const a = document.activeElement;
    if (a && isLoginField(a) && !closedFor.has(a)) showMenu(a, true);
  }

  const PK_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21a7 7 0 0 1 11-5.7"/><circle cx="17" cy="13" r="2.6"/><path d="M17 15.6V22l1.6-1.4L17 19"/></svg>';

  // A centered Keyvane dialog. render(api) fills it; returns once the user decides.
  function dialog(id, title, build) {
    closeDlg();
    const el = document.createElement('keyvane-passkey');
    el.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;';
    const root = el.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .bg{position:fixed;inset:0;background:rgba(3,4,10,.45);backdrop-filter:blur(3px);animation:fade .2s ease-out}
        @keyframes fade{from{opacity:0}}
        .card{position:fixed;left:50%;top:72px;transform:translateX(-50%);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;color:#eef0f7;
          width:360px;max-width:calc(100vw - 24px);box-sizing:border-box;border-radius:18px;padding:18px;display:grid;gap:14px}
        .top{display:flex;gap:12px;align-items:center}
        .logo{width:44px;height:44px;border-radius:13px;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}
        .k{font:600 10px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.18em;text-transform:uppercase;color:#67e8f9}
        .t{font-weight:700;font-size:16px;letter-spacing:-.01em}
        .site{color:#9a9fb5;font-size:12.5px;overflow-wrap:anywhere}
        .x{margin-left:auto;align-self:flex-start;background:none;border:0;color:#8b90a6;font-size:20px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:7px}
        .x:hover{color:#fff;background:rgba(255,255,255,.08)}
        .acct{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer;padding:10px 11px;border-radius:12px;
          background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
        .acct:hover,.acct:focus-visible{outline:none;background:linear-gradient(90deg,rgba(139,92,246,.24),rgba(34,211,238,.08));border-color:rgba(167,139,250,.45)}
        .av{width:32px;height:32px;border-radius:9px;flex:none;display:grid;place-items:center;font-weight:700;color:#fff;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}
        .m{min-width:0;display:grid}.m b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.m span{font-size:12px;color:#9a9fb5}
        .list{display:grid;gap:6px;max-height:240px;overflow:auto}
        .row{display:flex;gap:8px}
        button.b{font:inherit;font-weight:600;border-radius:11px;height:38px;padding:0 14px;cursor:pointer;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#eef0f7}
        button.b:hover{background:rgba(255,255,255,.1)}
        button.p{flex:1;border:0;color:#fff}
        .alt{background:none!important;border:0!important;color:#9a9fb5!important;font-weight:500!important;height:auto!important;padding:2px 0!important;justify-self:center;text-decoration:underline;text-underline-offset:3px}
        .alt:hover{color:#fff!important}
        .msg{color:#cfd3e3}.err{color:#fb7185;font-size:12px}
        ${HOLO}
      </style>
      <div class="bg"></div>
      <div class="card" role="dialog" aria-modal="true" aria-label="Keyvane passkey">
        <div class="top"><div class="logo">${PK_ICON}</div>
          <div style="min-width:0"><div class="k">Keyvane passkey</div><div class="t"></div><div class="site"></div></div>
          <button class="x" title="Cancel" aria-label="Cancel">×</button></div>
        <div class="body" style="display:grid;gap:12px"></div>
      </div>`;
    root.querySelector('.t').textContent = title;
    root.querySelector('.site').textContent = location.hostname;
    return new Promise(resolve => {
      const finish = v => { document.removeEventListener('keydown', onKey, true); closeDlg(); resolve(v); };
      const onKey = e => { if (e.key === 'Escape' && pkDlg?.el === el) { e.stopPropagation(); finish({ cancel: true }); } };
      document.addEventListener('keydown', onKey, true);
      root.querySelector('.x').addEventListener('click', () => finish({ cancel: true }));
      const body = root.querySelector('.body');
      const api = {
        body, finish,
        button: (text, cls, fn) => { const b = document.createElement('button'); b.className = 'b ' + (cls || ''); b.textContent = text; b.addEventListener('click', fn); return b; },
        text: (t, cls = 'msg') => { const d = document.createElement('div'); d.className = cls; d.textContent = t; return d; }
      };
      const render = () => { body.textContent = ''; build(api); };
      pkDlg = { id, el, refresh: render };
      render();
      document.documentElement.appendChild(el);
      setTimeout(() => root.querySelector('.p, .acct')?.focus(), 30);
    });
  }

  // While locked: offer to unlock, then rebuild the dialog when the vault opens.
  function lockedView(api, what) {
    api.body.append(api.text(`Keyvane is locked. Unlock it to ${what}.`));
    const row = document.createElement('div'); row.className = 'row';
    row.append(api.button('Unlock Keyvane', 'p', () => send({ type: 'kv-unlock' })));
    api.body.append(row, api.button('Use another device or security key', 'alt', () => api.finish({ fallback: true })));
  }

  async function pkCreate(id, opts) {
    const pre = (await send({ type: 'kv-pk-precheck', opts })) || {};
    if (pre.bad || pre.unsupported) return pkReply(id, { status: 'fallback' });
    const who = opts.user?.name || opts.user?.displayName || '';
    let state = pre;
    const shown = dialog(id, 'Save a passkey?', api => {
      if (state.locked) return lockedView(api, 'save this passkey');
      if (state.excluded) {
        api.body.append(api.text(`You already have a passkey for ${state.rpId} saved in Keyvane${state.excluded !== true ? ` (${state.excluded})` : ''}.`));
        api.body.append(api.button('OK', 'p', () => api.finish({ excluded: true })));
        return;
      }
      api.body.append(api.text(`Keyvane will create a passkey for ${who ? `“${who}” on ` : ''}${state.rpId} and keep it in your encrypted vault${/Safari\//.test(navigator.userAgent) && !/Chrom(e|ium)\/|Edg\//.test(navigator.userAgent) ? '' : ', synced with your browser sign-in'}.`));
      const err = api.text('', 'err');
      const row = document.createElement('div'); row.className = 'row';
      const go = api.button('Save passkey in Keyvane', 'p', async () => {
        go.disabled = true; go.textContent = 'Creating…';
        const r = (await send({ type: 'kv-pk-create', opts })) || {};
        if (r.cred) return api.finish({ cred: r.cred });
        if (r.locked) { state = { ...state, locked: true }; return pkDlg?.refresh(); }
        go.disabled = false; go.textContent = 'Save passkey in Keyvane';
        err.textContent = r.full ? 'Your Keyvane vault is full.' : r.syncing ? 'Keyvane is still syncing — try again in a moment.' : 'Couldn’t create the passkey.';
      });
      row.append(go);
      api.body.append(row, err, api.button('Use another device or security key', 'alt', () => api.finish({ fallback: true })));
    });
    pkDlg.reload = async () => { state = (await send({ type: 'kv-pk-precheck', opts })) || state; };
    const res = await shown;
    if (res.cred) pkReply(id, { status: 'ok', cred: res.cred });
    else if (res.fallback) pkReply(id, { status: 'fallback' });
    else if (res.excluded) pkReply(id, { status: 'error', name: 'InvalidStateError', message: 'A passkey for this account already exists.' });
    else if (res.cancel) pkReply(id, { status: 'error', name: 'NotAllowedError', message: 'The user cancelled.' });
  }

  async function pkGet(id, opts) {
    let list = (await send({ type: 'kv-pk-list', opts })) || {};
    if (list.bad || (!list.locked && !(list.items || []).length)) return pkReply(id, { status: 'fallback' });
    const shown = dialog(id, 'Sign in with a passkey', api => {
      if (list.locked) return lockedView(api, 'use your passkey');
      const box = document.createElement('div'); box.className = 'list';
      const err = api.text('', 'err');
      for (const k of list.items) {
        const b = document.createElement('button'); b.className = 'acct';
        b.innerHTML = '<span class="av"></span><span class="m"><b></b><span></span></span>';
        b.querySelector('.av').textContent = (k.username || '?')[0].toUpperCase();
        b.querySelector('b').textContent = k.username || '(no username)';
        b.querySelector('.m span').textContent = 'Passkey' + (k.title ? ' · ' + k.title : '');
        b.addEventListener('click', async () => {
          const r = (await send({ type: 'kv-pk-get', opts, entryId: k.id })) || {};
          if (r.cred) return api.finish({ cred: r.cred });
          if (r.locked) { list = { locked: true }; return pkDlg?.refresh(); }
          err.textContent = 'Couldn’t use this passkey.';
        });
        box.append(b);
      }
      if (!list.items.length) box.append(api.text('No Keyvane passkey for this site.'));
      api.body.append(box, err, api.button('Use another device or security key', 'alt', () => api.finish({ fallback: true })));
    });
    pkDlg.reload = async () => { list = (await send({ type: 'kv-pk-list', opts })) || list; };
    const res = await shown;
    if (res.cred) pkReply(id, { status: 'ok', cred: res.cred });
    else if (res.fallback) pkReply(id, { status: 'fallback' });
    else if (res.cancel) pkReply(id, { status: 'error', name: 'NotAllowedError', message: 'The user cancelled.' });
  }

  // After unlocking from a dialog, rebuild it with the vault open.
  chrome.runtime.onMessage.addListener(async m => {
    if (m?.type !== 'kv-unlocked' || !pkDlg) return;
    const d = pkDlg;
    await d.reload?.();
    if (pkDlg === d) d.refresh();
  });

  window.postMessage({ __kv: 'pk-ready' }, location.origin);

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
        ${HOLO}
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
