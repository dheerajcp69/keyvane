# Keyvane

**A free, end-to-end encrypted password and passkey manager for Chrome, Edge and Safari.** No account, no servers, no tracking.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/occfjinobiaefhbkngbolamflknedmlo) · [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/jpoallppdlhipeeadnckmepilfckdold) · [Website](https://keyvane.vercel.app) · [Privacy policy](https://keyvane.vercel.app/privacy)

![Keyvane](store/screenshot-1.png)

## What it does

- **Suggests strong passwords** in sign-up and change-password forms, and fills the confirm box too (opt-in).
- **Saves logins as you sign in** (opt-in), and offers to update them when a password changes. Handles single-page apps and two-step logins.
- **Login menu**: click a login box and your saved logins for that site appear under it; one click fills both fields (opt-in).
- **Passkeys** (opt-in): when a site offers "Sign in with a passkey", Keyvane can create it and keep the private key in the encrypted vault, then sign you in from a Keyvane window or the login menu. You can always pick your device or a security key instead.
- **One-click fill** from the popup too, only on the site a login belongs to.
- **Password generator** with a strength meter, plus weak and reused password counts.
- **Syncs through your Chrome sign-in** (`chrome.storage.sync`). Edits on two computers merge instead of overwriting.
- **Imports CSV** exports from Chrome, Edge, Brave, Firefox, Safari, Bitwarden, LastPass, 1Password, Dashlane and Proton Pass.
- **Encrypted backup** export and import, auto-lock, master password change.

## How the encryption works

| Step | What happens |
|---|---|
| Key | Master password → PBKDF2-SHA256, 600,000 iterations, 16-byte random salt → 256-bit key |
| Vault | JSON → gzip → AES-256-GCM with a fresh 12-byte random IV on every save |
| Storage | Only `{salt, iv, ciphertext}` is written, split into 7 KB chunks in `chrome.storage.sync` |
| Session | The unlocked key lives in `chrome.storage.session` (memory only, extension-only access) and is cleared on lock, auto-lock or browser close |
| Network | The extension CSP sets `connect-src 'none'`: Keyvane cannot make network requests |
| Passkeys | ES256 (ECDSA P-256) key pairs from Web Crypto. The private key (PKCS#8) is stored inside the encrypted vault. Registration uses `none` attestation and reports the credential as backed up (BE/BS), since it syncs with the vault |

The master password is never stored. There is no recovery: forget it and the vault cannot be decrypted by anyone.

All cryptography uses the browser's Web Crypto API. The code is in [`extension/crypto.js`](extension/crypto.js).

## Repository layout

```
extension/   the extension for Chrome, Edge and Safari (Manifest V3, no build step, no dependencies)
  crypto.js      key derivation, encryption, password generator
  store.js       chunked vault storage on chrome.storage.sync
  vaultops.js    shared vault logic, CSV import, "known logins" index
  popup.*        the toolbar popup UI
  background.js  service worker for the opt-in "offer to save" feature
  content.js     login menu, password suggestions, save offers, passkey windows (opt-in)
  passkeys.js    the WebAuthn authenticator: key generation, CBOR/COSE, signing
  pk-page.js     page-world script that answers navigator.credentials (opt-in)
  lock3d.js, fx.js  the popup's 3D padlock and starfield
  platform.js    browser-specific wording (Chrome, Edge, Safari)
  fonts/         Space Grotesk, Inter, JetBrains Mono (SIL Open Font License), bundled so nothing loads from the web
safari/      script and guide to build the Safari app in Xcode
site/        keyvane.vercel.app (static, deployed on Vercel)
store/       Chrome Web Store screenshots and promo images
```

## Run it locally

1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.

For Safari, see [`safari/README.md`](safari/README.md).

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save the encrypted vault and settings |
| `activeTab` | Read the current tab's address when you open the popup, to show matching logins |
| `scripting` | Fill a login into the page when you click Fill |
| `<all_urls>` (optional) | Requested only when you turn on "Save and suggest passwords": the login menu, password suggestions, save offers and passkeys |

## Reporting security issues

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
