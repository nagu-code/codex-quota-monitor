# Security policy

## Report a vulnerability privately

Send suspected vulnerabilities to **kj@nagu.co**. Please do not open a public
issue, discussion, or pull request for a security report.

Include the affected version, a clear description, reproduction steps, and the
potential impact when possible. Do not send live access tokens, account cookies,
passwords, `auth.json`, DPAPI vault contents, private keys, or other credentials.
Use redacted examples instead. If sensitive material is exposed accidentally,
revoke or rotate it before continuing the report.

We will review reports and coordinate disclosure as resources permit. This
project does not currently offer a bug-bounty program or promise payment for
reports.

## Supported releases

Only the most recent version published by Nagu Corporate Private Limited on
this repository's GitHub Releases page is eligible for security fixes. Drafts,
release candidates, mirrors, repackaged installers, modified binaries, and older
versions are not supported. If no public release exists yet, no public build is
supported.

## Safe research boundaries

- Test only accounts and systems you own or are authorized to use.
- Do not access another person's data, disrupt service, degrade availability, or
  use social engineering.
- Stop and report the issue if testing could expose credentials or personal data.
- Allow reasonable time for investigation and remediation before disclosure.

These guidelines do not authorize activity prohibited by law or by the terms of
any third-party service.

## Security design summary

Codex Quota Monitor is designed as a local Windows desktop application. Its
security controls include a sandboxed Electron renderer, context isolation, a
restrictive content security policy, allowlisted browser-authentication URLs,
validated IPC senders, a local privileged application protocol, and hardened
Electron fuses. Saved account credentials are encrypted using Electron safe
storage backed by Windows DPAPI for the current Windows user and are verified by
an encrypt/decrypt round trip before plaintext cleanup.

The app does not scan Codex conversations or local session logs. Quota insights
come from the canonical account rate-limit response and locally retained quota
observations. Authentication is performed through the bundled OpenAI Codex
client and its browser sign-in flow.

Release notes, checksums, signatures, and provenance supplied with a particular
release are the evidence for that release. This policy is not itself a
certification of an unpublished candidate or unofficial binary.
