import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  ARTIFACTS,
  COMMIT_SHA,
  PRIVATE_RC_TAG,
  PRODUCT,
  RELEASE_MANIFEST_KIND,
  RELEASE_MANIFEST_SCHEMA_VERSION,
  RELEASE_MANIFEST_STATUSES,
  SIGNER_THUMBPRINT,
  VERSION,
} from "./release-contract.mjs";

const HASH = /^[a-f0-9]{64}$/u;

function fail(message) {
  throw new Error(`release manifest: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} keys must be exactly: ${expected.join(", ")}`);
  }
}

function nullableMatch(value, expression, label) {
  if (value !== null && (typeof value !== "string" || !expression.test(value))) {
    fail(`${label} is invalid`);
  }
}

export function validateManifest(manifest, { publish = false } = {}) {
  exactKeys(manifest, [
    "schemaVersion", "kind", "product", "version", "status", "hashAlgorithm",
    "source", "certification", "signing", "artifacts",
  ], "root");
  if (manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    fail(`schemaVersion must be ${RELEASE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (manifest.kind !== RELEASE_MANIFEST_KIND) fail("kind is invalid");
  if (manifest.product !== PRODUCT) fail("product is invalid");
  if (manifest.version !== VERSION) fail(`version must be ${VERSION}`);
  if (!RELEASE_MANIFEST_STATUSES.includes(manifest.status)) {
    fail("status is invalid");
  }
  if (manifest.hashAlgorithm !== "SHA-256") fail("hashAlgorithm must be SHA-256");

  exactKeys(manifest.source, ["privateRcTag", "privateCommit"], "source");
  nullableMatch(manifest.source.privateRcTag, PRIVATE_RC_TAG, "source.privateRcTag");
  nullableMatch(manifest.source.privateCommit, COMMIT_SHA, "source.privateCommit");

  exactKeys(manifest.certification, ["phase8EvidenceRef"], "certification");
  if (manifest.certification.phase8EvidenceRef !== null &&
      (typeof manifest.certification.phase8EvidenceRef !== "string" || !manifest.certification.phase8EvidenceRef.trim())) {
    fail("certification.phase8EvidenceRef is invalid");
  }

  exactKeys(manifest.signing, ["signatureFormat", "signerThumbprint", "sha256SumsDigest"], "signing");
  if (manifest.signing.signatureFormat !== "detached-cms-pkcs7") fail("signatureFormat is invalid");
  if (manifest.signing.signerThumbprint !== SIGNER_THUMBPRINT) fail("signerThumbprint is invalid");
  nullableMatch(manifest.signing.sha256SumsDigest, HASH, "signing.sha256SumsDigest");

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== ARTIFACTS.length) {
    fail(`artifacts must contain exactly ${ARTIFACTS.length} entries`);
  }
  for (let index = 0; index < ARTIFACTS.length; index += 1) {
    const artifact = manifest.artifacts[index];
    const [name, checksumListed] = ARTIFACTS[index];
    exactKeys(artifact, ["name", "sizeBytes", "sha256", "checksumListed"], `artifacts[${index}]`);
    if (artifact.name !== name) fail(`artifacts[${index}].name must be ${name}`);
    if (artifact.checksumListed !== checksumListed) fail(`checksumListed is invalid for ${name}`);
    if (artifact.sizeBytes !== null && (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1)) {
      fail(`sizeBytes is invalid for ${name}`);
    }
    nullableMatch(artifact.sha256, HASH, `sha256 for ${name}`);
  }

  if (manifest.status === "certified-phase-8" || publish) {
    if (manifest.status !== "certified-phase-8") fail("publication requires certified-phase-8 status");
    if (!PRIVATE_RC_TAG.test(manifest.source.privateRcTag || "")) fail("certified private RC tag is required");
    if (!COMMIT_SHA.test(manifest.source.privateCommit || "")) fail("certified private commit is required");
    if (!manifest.certification.phase8EvidenceRef) fail("Phase 8 evidence reference is required");
    if (!HASH.test(manifest.signing.sha256SumsDigest || "")) fail("SHA256SUMS digest is required");
    for (const artifact of manifest.artifacts) {
      if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1 || !HASH.test(artifact.sha256 || "")) {
        fail(`certified size and hash are required for ${artifact.name}`);
      }
    }
  }
  return manifest;
}

function parseArgs(argv) {
  const options = { publish: false, allowPending: false, manifestPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--publish") options.publish = true;
    else if (argv[index] === "--allow-pending") options.allowPending = true;
    else if (argv[index] === "--manifest") options.manifestPath = argv[++index];
    else fail(`unknown argument: ${argv[index]}`);
  }
  if (!options.manifestPath) fail("--manifest is required");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifestPath, "utf8"));
  validateManifest(manifest, options);
  if (manifest.status === "pending-phase-8" && !options.allowPending) {
    fail("pending manifest requires --allow-pending");
  }
  console.log(`Validated ${options.manifestPath} (${manifest.status}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
