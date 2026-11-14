// Vault storage on chrome.storage.sync — follows the user's Chrome/Google sign-in
// across devices, free, no server. Only ciphertext is ever written here.
//
// Layout:  vmeta  = { v, kdf, salt, iter, iv, z, n, created, updated }
//          vc0..vcN = ciphertext chunks (sync caps each item at 8 KB)

const sync = chrome.storage.sync;
const CHUNK = 7000;
export const QUOTA = (sync.QUOTA_BYTES || 102400) - 2048; // leave room for settings

export async function readVault() {
  const { vmeta } = await sync.get('vmeta');
  if (!vmeta) return migrateLocal();
  const keys = Array.from({ length: vmeta.n }, (_, i) => 'vc' + i);
  const parts = await sync.get(keys);
  const ct = keys.map(k => parts[k] || '').join('');
  // Sync can deliver items in any order; a length mismatch means it's mid-update.
  return { ...vmeta, ct, partial: vmeta.len != null && ct.length !== vmeta.len };
}

export async function writeVault(vault) {
  const { ct, partial, ...meta } = vault;
  meta.len = ct.length;
  const chunks = [];
  for (let i = 0; i < ct.length; i += CHUNK) chunks.push(ct.slice(i, i + CHUNK));
  const approx = ct.length + JSON.stringify(meta).length + chunks.length * 12;
  if (approx > QUOTA) {
    const err = new Error('Vault is full (Chrome sync allows ~100 KB).');
    err.code = 'QUOTA';
    throw err;
  }
  const { vmeta: old } = await sync.get('vmeta');
  const payload = { vmeta: { ...meta, n: chunks.length } };
  chunks.forEach((c, i) => (payload['vc' + i] = c));
  await sync.set(payload);
  if (old && old.n > chunks.length) {
    await sync.remove(Array.from({ length: old.n - chunks.length }, (_, i) => 'vc' + (chunks.length + i)));
  }
}

export async function eraseVault() {
  const { vmeta } = await sync.get('vmeta');
  const keys = ['vmeta'];
  if (vmeta) for (let i = 0; i < vmeta.n; i++) keys.push('vc' + i);
  await sync.remove(keys);
  await chrome.storage.local.remove('vault');
}

export async function usage() {
  try { return await sync.getBytesInUse(null); } catch { return 0; }
}

// Vaults made by v1.0 lived in storage.local — move them to sync once.
async function migrateLocal() {
  const { vault } = await chrome.storage.local.get('vault');
  if (!vault) return null;
  await writeVault({ ...vault, v: 2, z: 0, updated: vault.updated || Date.now() });
  await chrome.storage.local.remove('vault');
  return readVault();
}

export const getSetting = async (k, dflt) => ((await sync.get(k))[k] ?? dflt);
export const setSetting = (k, v) => sync.set({ [k]: v });
