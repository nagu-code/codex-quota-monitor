# Desktop app privacy

Last updated: 5 November 2026

Codex Quota Monitor is a desktop utility with local-network sharing, published by Nagu Corporate Private Limited.

This notice describes the refreshed desktop build, including its built-in LAN viewer. Older releases may have different features; the notice supplied with that release also applies to its behavior. The product website has a separate website privacy and cookies notice. There is no Nagu account or hosted quota database for this desktop product.

## Data processed

The app displays the account label, locally entered owner name and subscription due date, ChatGPT email address, plan type, one canonical Codex quota window, its reset time, API-reported credits balance when available, reset-bank balance, and connection status for accounts that the user explicitly connects. It does not display or retain Spark, reserve, secondary, model, or token-activity analytics.

## Storage and transmission

- The app has no analytics, advertising, telemetry, or external application backend.
- Authentication is handled by the bundled OpenAI Codex client through the official browser sign-in flow.
- Each connected account receives an isolated local Codex state directory under the current OS user's application-data directory.
- Saved account credentials use Electron safeStorage backed by Windows DPAPI, macOS Keychain, or GNOME Keyring/KWallet on Linux. Linux refuses the insecure `basic_text` fallback. Codex may require a short-lived plaintext `auth.json` while its local App Server starts or refreshes authentication; the monitor captures the latest credential into the verified encrypted vault and removes the plaintext file. A computer crash can interrupt that cleanup, so the next launch automatically re-seals a recoverable plaintext credential. These vaults are not portable between OS accounts or computers; connect accounts again on a new device.
- Account metadata, the latest quota snapshot, and provider-reported banked-reset details (including expiry dates) are stored locally. The app no longer collects historical quota analytics; old chart history is omitted when the updated app next saves account metadata.
- Account suggestions use those readings and a fixed-size local usage estimate (the previous measurement, accumulated percentage change and elapsed time). This estimate learns from successful refreshes, includes idle time, and does not record prompts, conversations, models used or task activity. It is not sent to Nagu or an AI service. There is no historical chart or growing activity log. Light/dark mode and layout preferences are also stored locally. Poppins fonts are bundled and do not contact Google Fonts at runtime.
- Owner names and due dates are saved locally on this device and are not sent to OpenAI. The latest API-reported credits balance is cached with account metadata; missing balances are shown as Unavailable.
- The Codex client communicates with OpenAI to authenticate and obtain account and quota readings. OpenAI receives the network and account information needed for those requests under its own terms and privacy policy. The monitor does not ask for or store your ChatGPT password and does not fetch your conversations or send prompts to calculate suggestions. Provider sign-in may involve OpenAI's own cookies and security checks in your browser.
- Encryption protects saved credentials at rest; it does not protect them from malware or an attacker controlling your unlocked OS account. Account names, email addresses, owner names, due dates and quota readings are not encrypted by the app. Local diagnostic output may contain account identifiers or provider error messages; inspect and redact it before sharing.

## Local-network sharing

While the desktop app runs, its built-in HTTP listener shares a dashboard on the computer's private IPv4 addresses (port 4319, or an available port through 4329). The Share button shows the current address. Anyone who can reach that address through the computer's firewall can view account labels, email addresses, owner names, due dates, plans, quota/credits, usable bank resets and expiries, refresh timestamps and suggestions. There is no password. HTTP does not encrypt these readings in transit; use this feature only on a trusted office/home network, without router port forwarding.

Viewers use the same desktop account data and can request Refresh all. They cannot add, edit, remove or sign in to accounts. Credentials, authentication URLs, raw provider errors and local file paths are excluded from shared responses. Refresh requests run on the desktop using its saved credentials; credentials never go to viewers. Updates stream to connected browsers, which retain the last displayed readings if the desktop disconnects and show an offline notice. The server asks browsers not to cache responses, but recipients can still copy or capture anything they can see. Quitting the app stops sharing; hiding it in the Windows tray keeps sharing active. Nagu does not receive the LAN readings or run a service for them.

## Retention and deletion

Data stays on the computer until you remove it. Removing an account removes its dashboard metadata and usage estimate, then attempts to move its managed sign-in directory to Trash or the Windows Recycle Bin. If that move fails, the app reports that the entry was removed but the sign-in directory remains. Removal does not delete your ChatGPT account or necessarily revoke an OpenAI session. Manage provider sessions in OpenAI's security settings when needed.

Uninstalling does not automatically delete dashboard data. The current packaged and development builds use these application-data directories:

- Windows: `%APPDATA%\codex-quota-monitor`
- macOS: `~/Library/Application Support/codex-quota-monitor`
- Linux: `$XDG_CONFIG_HOME/codex-quota-monitor`, or `~/.config/codex-quota-monitor` when unset.

Quit the app before removing its data directory. Confirm the actual directory used by your installation first, especially for older or custom builds. To reset without losing data, rename the directory rather than deleting it. Credentials moved to Trash/Recycle Bin remain recoverable until you empty it. OS keychain entries can persist separately; deleting them may make other saved vaults unreadable. Removing local files is not a guarantee of secure physical erasure from storage media.

Nagu does not back up this dashboard to the cloud. Your operating system, organization or backup software may keep copies under its own policies. Deletion cannot erase copies that LAN viewers, backup systems or support recipients have already retained. The app retains the latest successful readings after a failed fetch and identifies that failure; recommendations can be stale until a successful refresh.

## Support, external links and your choices

Opening Nagu's company or product website sends an ordinary browser request to that website; its privacy notice applies. Fonts and interface assets in the desktop app are bundled locally. Desktop use does not activate the website's optional analytics.

If you contact Nagu, we receive your email address and whatever message or attachments you send. We use these to respond, investigate the issue and maintain necessary support or security records, and retain them only as needed for those purposes or applicable legal obligations. Do not send passwords, tokens, account cookies or credential files. Nagu does not sell account readings or support correspondence, use them for advertising, or receive desktop quota data automatically. Email, hosting and other service providers may process support communications for us, including outside your country, under their applicable terms.

You control the local data and who can reach the LAN viewer. Only connect accounts you are authorized to use and only share data you are authorized to disclose. Your organization may have its own privacy obligations when sharing employee or customer information. Quit the app to stop LAN sharing; closing a window to the tray may leave it running.

Depending on applicable law, you may request access, correction, deletion or other rights for personal data Nagu actually holds, or raise a privacy complaint using the contact below. We may need information to locate and verify your request, but never your account password or tokens. We cannot remotely access or erase this app's local data or copies held by LAN viewers. Applicable statutory rights are not limited by this notice.

The app is intended for people authorized to manage their Codex accounts and is not directed to children. Changes to this notice will be dated and supplied with the updated app or product website; a policy update does not itself enable new data collection.

## Contact

Nagu Corporate Private Limited, Bengaluru, India.

Privacy, security and legal questions: [kj@nagu.co](mailto:kj@nagu.co).

Product support: [hello@nagu.co](mailto:hello@nagu.co).
