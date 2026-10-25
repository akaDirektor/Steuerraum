# Steuerraum

Public interface only; never commit tax records, private folder paths, document links, or tokens.

Microsoft Entra single-tenant SPA sign-in uses MSAL Browser with authorization code flow and PKCE. Client/tenant IDs identify the application and are not secrets. No client secret. Delegated Files.ReadWrite scope permits the signed-in user's file operations. Folder path is configured in browser storage and is not in source control.

After sign-in, configure your OneDrive folder containing register-2025.json. The app reads that private file and automatically saves edits once loaded. Version checks and If-Match protect against concurrent updates; on conflict export a local backup before reloading. Unsaved edits remain in browser storage. Sign out does not erase the local data cache.

The app must be registered with an SPA redirect URI matching the Pages URL including trailing slash. Tenant policy can require administrator consent. Real Microsoft sign-in must be verified by the owner.

Build: npm install; node --test tests/cloud.test.cjs; npx esbuild cloud-entry.js --bundle --format=iife --target=es2022 --outfile=_site/cloud.js. GitHub Actions builds, tests, and publishes.
