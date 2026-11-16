# Security policy

Keyvane protects people's passwords, so security reports are the top priority.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Instead, use GitHub's private vulnerability reporting on this repository (Security tab → "Report a vulnerability"), or the support contact on the Chrome Web Store listing.

Include the Keyvane version, what you found and how to reproduce it. You'll get a reply within 7 days, and credit in the release notes if you'd like it.

## Scope

In scope: the extension in `extension/` (encryption, storage, autofill, the save-and-suggest feature, passkeys) and the website in `site/`.

Out of scope: attacks that need malware already running on the user's computer, or a compromised Chrome profile.

## Passkey design notes

- The page-world script (`pk-page.js`) holds no keys or vault data. It forwards requests to the content script and builds the credential objects from the reply.
- The background worker decides which site a request is for from the browser's own record of the tab (`sender.url`), never from anything the page sends. The RP ID must equal the page's host or a parent domain of it, a page under a shared hosting suffix (for example `github.io` or `vercel.app`) can't claim that suffix, and plain `http` is refused except on `localhost`.
- Only top-frame requests are served. A passkey only signs for the RP ID it was created for.
- Nothing is created or used without a click in Keyvane's own window or login menu (closed shadow DOM). Keyvane reports user verification because the vault is unlocked with the master password and the user has just confirmed in Keyvane; it does not re-ask for the master password on each sign-in.
