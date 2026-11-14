// Keyvane: notices when you sign in and offers to save the login.
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
    for (let i = inputs.indexOf(pws[0]) - 1; i >= 0; i--) {
      const el = inputs[i];
      if (el.value && TEXTY.includes((el.getAttribute('type') || '').toLowerCase())) { username = el.value.trim(); break; }
    }
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
