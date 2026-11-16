# Keyvane for Safari (macOS and iOS)

Safari extensions ship inside a small Mac/iPhone app built with Xcode. The extension code is the
same as the Chrome version in [`../extension`](../extension); this folder only wraps it.

You need a Mac with Xcode 15 or later and an Apple Developer account (for the App Store).

## 1. Make the Xcode project

```sh
git clone https://github.com/dheerajcp69/keyvane.git
cd keyvane
BUNDLE_ID=com.yourname.keyvane sh safari/build-xcode.sh
```

This copies `extension/`, adds the Safari-only manifest key (Safari 17 or later), and runs Apple's
`safari-web-extension-converter`. It creates `safari/build/Keyvane/Keyvane.xcodeproj` with a macOS
app, an iOS app and their extensions. Use a bundle ID under your own team; the default is
`app.keyvane.Keyvane`.

## 2. Try it on your Mac

1. Open the `.xcodeproj` in Xcode.
2. For each target (the apps and the extensions), go to **Signing & Capabilities** and pick your team.
3. Choose the **Keyvane (macOS)** scheme and press **Run**. The Keyvane app opens.
4. In Safari: **Settings → Advanced → Show features for web developers**, then
   **Develop → Allow Unsigned Extensions** (needed for local builds only).
5. **Safari → Settings → Extensions**: turn on Keyvane.
6. Click the Keyvane icon in the toolbar and create your vault.
7. To use save-and-suggest, the login menu and passkeys, give Keyvane access to websites:
   in **Settings → Extensions → Keyvane**, set websites to **Allow**, or accept Safari's prompt
   when you turn the feature on.

## 3. Check these on a real device

These can only be tested in real Safari, so check them before you submit:

| What | Expected | If not |
|---|---|---|
| Popup, lock screen animation, list, editor | Same as Chrome | Report the screen |
| Save, suggest and the login menu | Same as Chrome after allowing website access | Check website access is set to Allow |
| Passkeys | Keyvane's window appears on a passkey sign-up (try webauthn.io) | Safari may refuse Keyvane's page script; then Safari's own iCloud Keychain passkeys take over and nothing breaks |
| Vault storage | Kept on this device | To move it, use Settings → Export encrypted backup, then Import on the other device |
| iPhone/iPad | Popup fits the sheet | Report the screen |

## 4. Publish to the App Store

1. Set **Version** to `1.5.0` and a **Build** number on every target.
2. **Product → Archive**, then **Distribute App → App Store Connect**. Do this once for macOS
   and once for iOS (or create one universal purchase in App Store Connect).
3. In App Store Connect, create the app:
   - Price: **Free**. Category: **Utilities** (or Productivity).
   - Privacy policy URL: `https://keyvane.vercel.app/privacy`
   - App Privacy: **Data Not Collected**. Keyvane makes no network requests.
   - Description: you can reuse the Chrome Web Store text. Mention it is a Safari extension and
     that users enable it in Safari Settings → Extensions.
   - Screenshots: take them from Safari with the extension open.
   - Export compliance: Keyvane only uses the encryption built into Safari (Web Crypto:
     AES-256-GCM, PBKDF2, ECDSA). Answer Apple's encryption questions accordingly; for most
     apps that only use standard encryption this falls under an exemption, but the answer is yours to give.
4. Submit for review.
