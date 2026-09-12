# Desktop application privacy

Codex Quota Monitor is a local Windows desktop utility published by Nagu
Corporate Private Limited. This document covers the desktop application only.
The product website, GitHub, OpenAI, and other services have their own privacy
practices.

## Data the app processes

For accounts the user explicitly connects, the app displays the account label,
ChatGPT email address, plan type, one canonical Codex quota window and its reset
time, reset-bank balance, and connection status. It also retains a bounded local
history of canonical quota snapshots for dashboard history views.

The app does not display or retain Spark, reserve, secondary,
purchased-balance, model, or token-activity analytics. It does not scan Codex
conversations or local session logs.

## Telemetry and network activity

The desktop app has no analytics, advertising, telemetry, or Nagu-operated
application backend. Nagu does not receive the account metadata, credentials, or
quota history processed by the desktop app.

The app is not an offline tool. Authentication and quota refreshes use the
bundled OpenAI Codex client and the official browser sign-in flow, which
communicate with OpenAI services under OpenAI's applicable terms and privacy
practices.

## Local storage and credential protection

Each connected account has an isolated local Codex state directory under the
current Windows user's application-data directory. Saved credentials are
encrypted using Electron safe storage backed by Windows DPAPI and are therefore
tied to the current Windows user.

The Codex client can require a short-lived plaintext `auth.json` while its local
App Server starts or refreshes authentication. The monitor captures the latest
credential in the verified DPAPI vault and removes the plaintext file. A crash
can interrupt cleanup, so the next launch attempts to re-seal a recoverable
plaintext credential.

Account metadata, application preferences, and the bounded quota-history data
needed for dashboard views are stored locally in the current Windows user's app
data.

## Retention and deletion

Removing an account in the app moves that account's managed state directory to
the Windows Recycle Bin. Uninstalling the application does not automatically
delete dashboard data so that settings can survive a reinstall.

To remove all remaining local app data, quit Codex Quota Monitor and delete:

```text
%APPDATA%\Codex Quota Monitor
```

Items moved to the Recycle Bin must also be emptied if permanent deletion is
desired.

## Contact

Privacy and security questions: **kj@nagu.co**
