// Keyvane passkeys, page side. Runs in the page's own JavaScript world so it can answer
// navigator.credentials.create/get. It holds no keys and no vault data: it forwards the
// request to Keyvane's content script and turns the reply into a PublicKeyCredential.
// Whenever Keyvane is not used, the browser's own passkey prompt runs exactly as before.
(() => {
  if (!window.isSecureContext || !navigator.credentials || window.top !== window) return;
  if (Object.getOwnPropertyDescriptor(window, '__keyvanePk')) return;
  Object.defineProperty(window, '__keyvanePk', { value: true });

  const creds = navigator.credentials;
  const nativeCreate = creds.create.bind(creds);
  const nativeGet = creds.get.bind(creds);

  const enc = buf => {
    const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const dec = s => {
    const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b.buffer;
  };
  const isBin = v => v instanceof ArrayBuffer || ArrayBuffer.isView(v);

  /* ---- talking to the content script ---- */
  // Keyvane's content script loads after this script; requests wait until it says it's ready.
  const waiting = new Map();
  let ready = false; const queue = [];
  const readyTimer = setTimeout(() => { if (!ready) { ready = 'none'; queue.splice(0).forEach(m => waiting.get(m.id)?.({ status: 'fallback' })); } }, 4000);
  addEventListener('message', ev => {
    const d = ev.data;
    if (ev.source !== window || !d) return;
    if (d.__kv === 'pk-ready' && ready !== true) { ready = true; clearTimeout(readyTimer); queue.splice(0).forEach(send); return; }
    if (d.__kv !== 'pk-res') return;
    const w = waiting.get(d.id);
    if (w) w(d);
  });
  const send = m => window.postMessage({ __kv: 'pk-req', ...m }, location.origin);
  const post = m => {
    if (ready === true) return send(m);
    if (ready === 'none') { if (m.op !== 'cancel') setTimeout(() => waiting.get(m.id)?.({ status: 'fallback' })); return; }
    if (m.op === 'cancel') { const i = queue.findIndex(q => q.id === m.id); if (i >= 0) queue.splice(i, 1); return; }
    queue.push(m);
  };
  const newId = () => enc(crypto.getRandomValues(new Uint8Array(12)));

  /* ---- options to plain JSON ---- */
  function creationOpts(pk) {
    return {
      rp: { id: pk.rp?.id, name: pk.rp?.name },
      user: { id: isBin(pk.user?.id) ? enc(pk.user.id) : '', name: pk.user?.name, displayName: pk.user?.displayName },
      challenge: isBin(pk.challenge) ? enc(pk.challenge) : '',
      pubKeyCredParams: (pk.pubKeyCredParams || []).map(p => ({ type: p.type, alg: p.alg })),
      excludeCredentials: (pk.excludeCredentials || []).filter(c => isBin(c.id)).map(c => ({ type: c.type, id: enc(c.id) })),
      authenticatorSelection: pk.authenticatorSelection ? { ...pk.authenticatorSelection } : undefined,
      extensions: pk.extensions?.credProps ? { credProps: true } : undefined
    };
  }
  function requestOpts(pk) {
    return {
      rpId: pk.rpId, challenge: isBin(pk.challenge) ? enc(pk.challenge) : '',
      allowCredentials: (pk.allowCredentials || []).filter(c => isBin(c.id)).map(c => ({ type: c.type, id: enc(c.id) })),
      userVerification: pk.userVerification
    };
  }

  /* ---- replies to real PublicKeyCredential objects ---- */
  const def = (o, props) => { for (const k in props) Object.defineProperty(o, k, { value: props[k], enumerable: true, configurable: true }); return o; };
  const proto = n => (window[n] && window[n].prototype) || Object.prototype;

  function attestationCredential(c, wantProps) {
    const response = def(Object.create(proto('AuthenticatorAttestationResponse')), {
      clientDataJSON: dec(c.clientDataJSON), attestationObject: dec(c.attestationObject)
    });
    def(response, {
      getTransports: () => c.transports.slice(), getAuthenticatorData: () => dec(c.authenticatorData),
      getPublicKey: () => dec(c.publicKey), getPublicKeyAlgorithm: () => c.publicKeyAlgorithm
    });
    const ext = wantProps ? { credProps: { rk: true } } : {};
    return def(Object.create(proto('PublicKeyCredential')), {
      id: c.id, rawId: dec(c.id), type: 'public-key', authenticatorAttachment: 'platform', response,
      getClientExtensionResults: () => JSON.parse(JSON.stringify(ext)),
      toJSON: () => ({ id: c.id, rawId: c.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: ext,
        response: { clientDataJSON: c.clientDataJSON, attestationObject: c.attestationObject, authenticatorData: c.authenticatorData,
          transports: c.transports.slice(), publicKey: c.publicKey, publicKeyAlgorithm: c.publicKeyAlgorithm } })
    });
  }
  function assertionCredential(c) {
    const response = def(Object.create(proto('AuthenticatorAssertionResponse')), {
      clientDataJSON: dec(c.clientDataJSON), authenticatorData: dec(c.authenticatorData), signature: dec(c.signature),
      userHandle: c.userHandle ? dec(c.userHandle) : null
    });
    return def(Object.create(proto('PublicKeyCredential')), {
      id: c.id, rawId: dec(c.id), type: 'public-key', authenticatorAttachment: 'platform', response,
      getClientExtensionResults: () => ({}),
      toJSON: () => ({ id: c.id, rawId: c.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: c.clientDataJSON, authenticatorData: c.authenticatorData, signature: c.signature, userHandle: c.userHandle } })
    });
  }

  const fail = (name, msg) => new DOMException(msg || 'The operation either timed out or was not allowed.', name);

  // One request to Keyvane; resolves with its reply, or rejects if the page aborts.
  function ask(op, payload, signal, onMessage) {
    return new Promise((resolve, reject) => {
      const id = newId();
      const done = () => { waiting.delete(id); signal?.removeEventListener('abort', onAbort); };
      const onAbort = () => { done(); post({ id, op: 'cancel' }); reject(signal.reason ?? fail('AbortError', 'The operation was aborted.')); };
      if (signal?.aborted) return reject(signal.reason ?? fail('AbortError', 'The operation was aborted.'));
      signal?.addEventListener('abort', onAbort, { once: true });
      waiting.set(id, d => {
        if (onMessage && onMessage(d, id) === 'keep') return;
        done(); resolve(d);
      });
      post({ id, op, payload });
    });
  }

  const patched = {
    async create(options) {
      const pk = options?.publicKey;
      if (!pk) return nativeCreate(options);
      const r = await ask('create', creationOpts(pk), options.signal);
      if (r.status === 'ok') return attestationCredential(r.cred, !!pk.extensions?.credProps);
      if (r.status === 'error') throw fail(r.name, r.message);
      return nativeCreate(options);
    },

    async get(options) {
      const pk = options?.publicKey;
      if (!pk) return nativeGet(options);

      if (options.mediation !== 'conditional') {
        const r = await ask('get', requestOpts(pk), options.signal);
        if (r.status === 'ok') return assertionCredential(r.cred);
        if (r.status === 'error') throw fail(r.name, r.message);
        return nativeGet(options);
      }

      // Autofill passkeys (mediation: "conditional"): Keyvane's passkeys appear in its login
      // menu while the browser's own autofill keeps working. Whichever the user picks wins.
      const ctrl = new AbortController();
      const outer = options.signal;
      if (outer?.aborted) throw outer.reason ?? fail('AbortError');
      outer?.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true });
      let reqId = null;
      return new Promise((resolve, reject) => {
        let settled = false, oursOut = false, theirsErr = null;
        const finish = (fn, v) => {
          if (settled) return; settled = true;
          if (reqId) post({ id: reqId, op: 'cancel' });
          if (!ctrl.signal.aborted) ctrl.abort(fail('AbortError', 'Settled'));
          fn(v);
        };
        ask('conditional', requestOpts(pk), ctrl.signal, (d, id) => { reqId = id; return d.status === 'listening' ? 'keep' : undefined; })
          .then(r => {
            if (r.status === 'ok') return finish(resolve, assertionCredential(r.cred));
            if (r.status === 'error') return finish(reject, fail(r.name, r.message));
            oursOut = true; if (theirsErr) finish(reject, theirsErr); // Keyvane has nothing here
          }, e => finish(reject, e));
        nativeGet({ ...options, signal: ctrl.signal }).then(c => finish(resolve, c), e => {
          // The browser's autofill gave up; keep Keyvane's offer open unless it has nothing.
          if (outer?.aborted || oursOut) finish(reject, e); else theirsErr = e;
        });
      });
    }
  };

  // Keep the methods looking native to pages that inspect them.
  for (const name of ['create', 'get']) {
    const fn = { [name](options) { return patched[name].call(this, options); } }[name];
    Object.defineProperty(fn, 'toString', { value: () => `function ${name}() { [native code] }` });
    Object.defineProperty(CredentialsContainer.prototype, name, { value: fn, writable: true, configurable: true, enumerable: true });
  }
})();
