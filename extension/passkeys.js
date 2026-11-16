// Keyvane passkeys: a WebAuthn authenticator whose keys live in the encrypted vault.
// ES256 (ECDSA P-256 + SHA-256) keys, "none" attestation, discoverable credentials.
import * as C from './crypto.js';

// Identifies Keyvane as the passkey provider (used by sites that list providers by AAGUID).
const AAGUID = new Uint8Array([0x6b, 0x76, 0x61, 0x6e, 0x65, 0x2d, 0x4b, 0x56, 0x1a, 0x05, 0x50, 0x4b, 0x89, 0x3c, 0x0e, 0x71]);

/* ---- base64url ---- */
export const b64u = buf => C.b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => C.unb64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));

/* ---- minimal canonical CBOR encoder (ints, byte/text strings, maps) ---- */
function head(major, n) {
  if (n < 24) return [major << 5 | n];
  if (n < 0x100) return [major << 5 | 24, n];
  if (n < 0x10000) return [major << 5 | 25, n >> 8, n & 255];
  return [major << 5 | 26, n >>> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255];
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = new TextEncoder().encode(v); return [...head(3, b.length), ...b]; }
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  if (v instanceof Map) { const out = head(5, v.size); for (const [k, x] of v) out.push(...cbor(k), ...cbor(x)); return out; }
  throw new TypeError('cbor');
}

const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
const sha256 = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const u32 = n => new Uint8Array([n >>> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255]);

// Flags: UP (user present) | UV (user verified) | BE (backup eligible) | BS (backed up: syncs with the vault)
const FLAGS = 0x01 | 0x04 | 0x08 | 0x10;
const AT = 0x40;

/* ---- relying-party checks ---- */
// Shared hosting suffixes where unrelated sites sit side by side. A site under one of
// these may not claim the shared parent as its relying party.
const SHARED = new Set(['github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com',
  'appspot.com', 'blogspot.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'onrender.com', 'fly.dev', 'glitch.me', 'replit.app', 'repl.co',
  'surge.sh', 'wordpress.com', 'tumblr.com', 'myshopify.com', 'wixsite.com', 'webflow.io', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'deno.dev',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.in', 'org.in', 'net.in', 'gov.in', 'ac.in', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.cn', 'com.mx', 'com.sg', 'com.tr', 'co.za', 'co.kr', 'com.tw', 'com.hk', 'com.ar', 'com.my', 'com.ph', 'com.pk', 'com.ng', 'com.eg']);

// The page origin comes from Chrome's record of the tab, never from the page itself.
export function checkRp(pageUrl, rpId) {
  let u; try { u = new URL(pageUrl); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const secure = u.protocol === 'https:' || (u.protocol === 'http:' && (host === 'localhost' || host.endsWith('.localhost')));
  if (!secure) return null;
  const rp = String(rpId || host).toLowerCase();
  if (!(host === rp || host.endsWith('.' + rp))) return null;
  if (rp !== host && (!rp.includes('.') || SHARED.has(rp))) return null;
  return { origin: u.origin, rpId: rp };
}

function clientData(type, challenge, origin) {
  // Key order and spacing match what browsers emit.
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function derSig(raw) {
  const int = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); return b[0] & 0x80 ? cat(new Uint8Array([0]), b) : b; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  return cat(new Uint8Array([0x30, r.length + s.length + 4, 0x02, r.length]), r, new Uint8Array([0x02, s.length]), s);
}

/* ---- registration ---- */
// opts: serialized PublicKeyCredentialCreationOptions (binary fields base64url)
export async function makeCredential(opts, rp) {
  const algs = (opts.pubKeyCredParams || []).map(p => p.alg);
  if (algs.length && !algs.includes(-7)) return { unsupported: true };

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const credId = C.randomBytes(16);

  const cose = new Uint8Array(cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, rawPub.slice(1, 33)], [-3, rawPub.slice(33, 65)]])));
  const authData = cat(await sha256(new TextEncoder().encode(rp.rpId)), new Uint8Array([FLAGS | AT]), u32(0),
    AAGUID, new Uint8Array([0, credId.length]), credId, cose);
  const attObj = new Uint8Array(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])));
  const cdj = clientData('webauthn.create', opts.challenge, rp.origin);

  const now = Date.now();
  const entry = {
    id: b64u(C.randomBytes(12)), kind: 'passkey', rpId: rp.rpId, host: rp.rpId.replace(/^www\./, ''), url: rp.origin,
    title: opts.rp?.name && opts.rp.name !== rp.rpId ? String(opts.rp.name).slice(0, 80) : '',
    username: String(opts.user?.name || opts.user?.displayName || '').slice(0, 200),
    displayName: String(opts.user?.displayName || '').slice(0, 200),
    userHandle: opts.user?.id || '', credId: b64u(credId), key: C.b64(pkcs8), alg: -7, counter: 0, notes: '', created: now, updated: now
  };
  const cred = {
    id: entry.credId, clientDataJSON: b64u(cdj), attestationObject: b64u(attObj), authenticatorData: b64u(authData),
    publicKey: b64u(spki), publicKeyAlgorithm: -7, transports: ['hybrid', 'internal']
  };
  return { entry, cred };
}

/* ---- authentication ---- */
export async function getAssertion(entry, opts, rp) {
  const priv = await crypto.subtle.importKey('pkcs8', C.unb64(entry.key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Synced passkeys report a zero signature counter, as Apple and Google do.
  const authData = cat(await sha256(new TextEncoder().encode(entry.rpId)), new Uint8Array([FLAGS]), u32(0));
  const cdj = clientData('webauthn.get', opts.challenge, rp.origin);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, cat(authData, await sha256(cdj))));
  return { id: entry.credId, clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(derSig(raw)), userHandle: entry.userHandle || null };
}

export const isPasskey = e => e && e.kind === 'passkey';
