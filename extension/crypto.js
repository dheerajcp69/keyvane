// Keyvane crypto — WebCrypto only, nothing leaves the device.
// Master password -> PBKDF2-SHA256 (600k iterations) -> AES-256-GCM key.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const DEFAULT_ITERATIONS = 600000;

export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Compress-then-encrypt (gzip) so more logins fit in Chrome sync's 100 KB.
export async function encryptJSON(key, obj) {
  const iv = randomBytes(12);
  const packed = await pipe(enc.encode(JSON.stringify(obj)), new CompressionStream('gzip'));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed);
  return { iv: b64(iv), ct: b64(ct), z: 1 };
}

export async function decryptJSON(key, { iv, ct, z }) {
  let pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct)));
  if (z) pt = await pipe(pt, new DecompressionStream('gzip'));
  return JSON.parse(dec.decode(pt));
}

export async function exportKey(key) {
  return b64(await crypto.subtle.exportKey('raw', key));
}

export async function importKey(raw) {
  return crypto.subtle.importKey('raw', unb64(raw), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

// Unbiased random index via rejection sampling
function randIndex(n) {
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= max);
  return buf[0] % n;
}

const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~'
};

export function generatePassword({ length = 20, upper = true, digits = true, symbols = true } = {}) {
  const pools = [SETS.lower];
  if (upper) pools.push(SETS.upper);
  if (digits) pools.push(SETS.digits);
  if (symbols) pools.push(SETS.symbols);
  const all = pools.join('');
  // Guarantee one char from each chosen set, then fill and shuffle.
  const chars = pools.map(p => p[randIndex(p.length)]);
  while (chars.length < length) chars.push(all[randIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length).join('');
}

// 0..4 strength score from a rough entropy estimate
export function strength(pw) {
  if (!pw) return { score: 0, label: 'Empty', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
  let bits = pw.length * Math.log2(pool || 1);
  if (/(.)\1{2,}/.test(pw)) bits -= 10;
  if (/^(password|qwerty|123456|letmein|admin|welcome)/i.test(pw)) bits = Math.min(bits, 10);
  const score = bits < 28 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, bits: Math.round(bits), label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'][score] };
}
