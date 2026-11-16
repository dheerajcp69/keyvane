// Which browser Keyvane runs in, for wording and store links. Behaviour is the same everywhere.
const ua = navigator.userAgent;
const safari = /Safari\//.test(ua) && !/Chrom(e|ium)\/|Edg\//.test(ua);
const edge = /Edg\//.test(ua);

export const P = safari
  ? { name: 'Safari', id: 'safari', syncs: false, account: '', reviewUrl: '' }
  : edge
    ? { name: 'Edge', id: 'edge', syncs: true, account: 'Microsoft account', reviewUrl: '' }
    : { name: 'Chrome', id: 'chrome', syncs: true, account: 'Chrome sign-in', reviewUrl: 'https://chromewebstore.google.com/detail/occfjinobiaefhbkngbolamflknedmlo/reviews' };
