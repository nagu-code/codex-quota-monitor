export const VERSION = "1.5.0";
export const PRODUCT = "Codex Quota Monitor";
export const RELEASE_MANIFEST_SCHEMA_VERSION = 2;
export const RELEASE_MANIFEST_KIND = "nagu-codex-quota-monitor-public-release";
export const RELEASE_MANIFEST_STATUSES = Object.freeze([
  "pending-phase-8",
  "certified-phase-8",
  "fixture",
]);
export const SIGNER_THUMBPRINT = "8452BCAFAD093D33D122097AD7D112A42A26526D";
export const COMMIT_SHA = /^[a-f0-9]{40}$/u;
export const PRIVATE_RC_TAG = /^v1\.5\.0-rc\.[1-9][0-9]*$/u;

export const ARTIFACTS = Object.freeze([
  ["Codex-Quota-Monitor-Setup-1.5.0-x64-Unsigned.exe", true],
  ["Nagu-Codex-Quota-Monitor-1.5.0-Locally-Signed.zip", true],
  ["INSTALLATION.txt", true],
  ["LICENSE.txt", true],
  ["SHA256SUMS.txt", false],
  ["SHA256SUMS.p7s", false],
]);

export const SIGNED_ZIP_ENTRIES = Object.freeze([
  "CODEX-LICENSE.txt",
  "Codex-Quota-Monitor-Setup-1.5.0-x64-Nagu-Self-Signed.exe",
  "Install-NaguCodexCurrentUserCertificateTrust.ps1",
  "INSTALLATION.txt",
  "LICENSE.txt",
  "Nagu-Corporate-Code-Signing.cer",
  "PRIVACY.md",
  "Remove-NaguCodexCurrentUserCertificateTrust.ps1",
  "SECURITY.md",
  "SHA256SUMS.p7s",
  "SHA256SUMS.txt",
  "SIGNED-PAYLOAD-MANIFEST.json",
  "SIGNING-POLICY.md",
  "Test-NaguCodexDistributionIntegrity.ps1",
  "THIRD-PARTY-NOTICES.md",
]);

export const PRIVATE_OR_SOURCE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|auth\.json$|id_(?:rsa|dsa|ecdsa|ed25519)$|electron\/|renderer\/|src\/|node_modules\/|app\.asar(?:\.unpacked)?\/)|\.(?:pfx|p12|p8|pem|key|ppk|jks|keystore|ts|tsx|jsx|cjs|mjs)(?:$|\/)/iu;

export const PRIVATE_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"(?:access_token|refresh_token|client_secret|private_key)"\s*:/iu;
