# Release verification

The current desktop release uses `v1.5.0.json` and `v1.5.0-verification.json` in this directory. These record the exact source revision, artifact sizes and SHA-256 hashes, and checks actually performed for the November 2026 desktop redesign.

The older Phase 8/9 tooling and pending manifest under `.github/releases/` are historical. This release does not claim that certification. Microsoft Store certification is also pending and is independent of direct distribution.

All six release assets must match this manifest. Both installer variants contain the same application resources. The self-signed ZIP does not carry a publicly trusted certificate-authority signature; follow `INSTALLATION.txt` and compare the independent hashes at https://nagu.co/codex-quota-monitor-trust.html before running or trusting an installer.
