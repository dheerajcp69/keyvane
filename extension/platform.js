// Which browser Keyvane runs in, for wording and store links. Behaviour is the same everywhere.
const ua = navigator.userAgent;
const safari = /Safari\//.test(ua) && !/Chrom(e|ium)\/|Edg\//.test(ua);
const edge = /Edg\//.test(ua);

export const P = safari
  ? { name: 'Safari', id: 'safari', syncs: false, account: '', reviewUrl: '' }
  : edge
    ? { name: 'Edge', id: 'edge', syncs: true, account: 'Microsoft account', reviewUrl: '' }
    : { name: 'Chrome', id: 'chrome', syncs: true, account: 'Chrome sign-in', reviewUrl: 'https://chromewebstore.google.com/detail/occfjinobiaefhbkngbolamflknedmlo/reviews' };

// Website access. Chrome and Edge use the optional "<all_urls>" permission. Safari keeps
// website access in its own settings (Settings → Extensions → Keyvane) and asks per site,
// so there the user's switch in Keyvane is the on/off and Safari decides which sites.
const ALL = { origins: ['<all_urls>'] };
export async function hasSiteAccess() {
  if (P.id === 'safari') return true;
  try { return await chrome.permissions.contains(ALL); } catch { return false; }
}
export async function requestSiteAccess() {
  try {
    const ok = await chrome.permissions.request(ALL);
    return P.id === 'safari' ? true : ok;
  } catch { return P.id === 'safari'; }
}
// Whether save-and-suggest is on, given the stored settings.
export async function offerOn(settings) {
  if (P.id === 'safari') return settings?.offerSave === true;
  return (await hasSiteAccess()) && settings?.offerSave !== false;
}
