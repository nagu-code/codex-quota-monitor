import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACTS,
  RELEASE_MANIFEST_KIND,
  RELEASE_MANIFEST_SCHEMA_VERSION,
  SIGNED_ZIP_ENTRIES,
} from "./release-contract.mjs";
import { validateReleaseAssets } from "./validate-release-assets.mjs";
import { validateManifest } from "./validate-release-manifest.mjs";
import { validatePublicationTarget } from "./validate-publication-target.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(contents);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const directory = Buffer.alloc(46 + nameBytes.length);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    nameBytes.copy(directory, 46);
    central.push(directory);
    offset += local.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function checksums(entries, excluded = []) {
  return [...entries]
    .filter(([name]) => !excluded.includes(name))
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, contents]) => `${sha256(Buffer.from(contents))} *${name}`)
    .join("\n") + "\n";
}

async function createFixture(root, fixture, { extraZipEntry = null } = {}) {
  const zipEntries = new Map(Object.entries(fixture.signedZipText));
  zipEntries.set("SHA256SUMS.txt", checksums(zipEntries, ["SHA256SUMS.p7s"]));
  if (extraZipEntry) zipEntries.set(extraZipEntry, "forbidden fixture entry\n");
  assert.deepEqual([...zipEntries.keys()].filter((name) => name !== extraZipEntry).sort(), [...SIGNED_ZIP_ENTRIES].sort());
  const signedZip = storedZip([...zipEntries]);
  const files = new Map(Object.entries(fixture.topLevelText));
  files.set("Nagu-Codex-Quota-Monitor-1.5.0-Locally-Signed.zip", signedZip);
  files.set("SHA256SUMS.txt", checksums(files, ["SHA256SUMS.p7s"]));
  for (const [name, contents] of files) await writeFile(path.join(root, name), contents);

  const manifest = {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    kind: RELEASE_MANIFEST_KIND,
    product: "Codex Quota Monitor",
    version: "1.5.0",
    status: "fixture",
    hashAlgorithm: "SHA-256",
    source: { privateRcTag: null, privateCommit: null },
    certification: { phase8EvidenceRef: null },
    signing: {
      signatureFormat: "detached-cms-pkcs7",
      signerThumbprint: "8452BCAFAD093D33D122097AD7D112A42A26526D",
      sha256SumsDigest: sha256(files.get("SHA256SUMS.txt")),
    },
    artifacts: [],
  };
  for (const [name, checksumListed] of ARTIFACTS) {
    const contents = files.get(name);
    manifest.artifacts.push({ name, sizeBytes: contents.length, sha256: sha256(contents), checksumListed });
  }
  const manifestPath = `${root}.manifest.json`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

async function expectFailure(action, pattern) {
  await assert.rejects(action, pattern);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(path.join(repositoryRoot, "test/fixtures/release-assets.json"), "utf8"));
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cqm-release-fixture-"));

try {
  const valid = path.join(temporaryRoot, "valid");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(valid));
  const validManifest = await createFixture(valid, fixture);
  await validateReleaseAssets({ manifestPath: validManifest, artifactsPath: valid });

  const fixtureManifest = JSON.parse(await readFile(validManifest, "utf8"));
  const obsoleteSchema = structuredClone(fixtureManifest);
  obsoleteSchema.schemaVersion = 1;
  assert.throws(
    () => validateManifest(obsoleteSchema),
    /schemaVersion must be 2/u,
  );

  const incompleteCertification = structuredClone(fixtureManifest);
  incompleteCertification.status = "certified-phase-8";
  assert.throws(
    () => validateManifest(incompleteCertification, { publish: true }),
    /certified private RC tag is required/u,
  );

  const certifiedManifest = structuredClone(fixtureManifest);
  certifiedManifest.status = "certified-phase-8";
  certifiedManifest.source.privateRcTag = "v1.5.0-rc.1";
  certifiedManifest.source.privateCommit = "1".repeat(40);
  certifiedManifest.certification.phase8EvidenceRef = "phase8:v1.5.0-rc.1:run-123";
  validateManifest(certifiedManifest, { publish: true });

  const legacySelfReference = structuredClone(certifiedManifest);
  legacySelfReference.source.publicCommit = "2".repeat(40);
  assert.throws(
    () => validateManifest(legacySelfReference, { publish: true }),
    /source keys must be exactly: privateCommit, privateRcTag/u,
  );

  const reviewedCommit = "a".repeat(40);
  assert.equal(validatePublicationTarget({
    draftTarget: reviewedCommit,
    workflowCommit: reviewedCommit,
    checkoutCommit: reviewedCommit,
  }), reviewedCommit);
  assert.throws(
    () => validatePublicationTarget({
      draftTarget: "main",
      workflowCommit: reviewedCommit,
      checkoutCommit: reviewedCommit,
    }),
    /authenticated draft target must be an exact lowercase 40-character commit SHA/u,
  );
  assert.throws(
    () => validatePublicationTarget({
      draftTarget: "A".repeat(40),
      workflowCommit: reviewedCommit,
      checkoutCommit: reviewedCommit,
    }),
    /authenticated draft target must be an exact lowercase 40-character commit SHA/u,
  );
  assert.throws(
    () => validatePublicationTarget({
      draftTarget: "b".repeat(40),
      workflowCommit: reviewedCommit,
      checkoutCommit: reviewedCommit,
    }),
    /authenticated draft target does not equal the workflow commit/u,
  );
  assert.throws(
    () => validatePublicationTarget({
      draftTarget: reviewedCommit,
      workflowCommit: reviewedCommit,
      checkoutCommit: "c".repeat(40),
    }),
    /checked-out commit does not equal the workflow commit/u,
  );

  const missingSignature = path.join(temporaryRoot, "missing-signature");
  await import("node:fs/promises").then(({ mkdir, cp }) => mkdir(missingSignature).then(() => cp(valid, missingSignature, { recursive: true })));
  await rm(path.join(missingSignature, "SHA256SUMS.p7s"));
  await expectFailure(
    () => validateReleaseAssets({ manifestPath: validManifest, artifactsPath: missingSignature }),
    /top-level artifact inventory/u,
  );

  const tampered = path.join(temporaryRoot, "tampered");
  await import("node:fs/promises").then(({ mkdir, cp }) => mkdir(tampered).then(() => cp(valid, tampered, { recursive: true })));
  await writeFile(path.join(tampered, "LICENSE.txt"), "tampered\n");
  await expectFailure(
    () => validateReleaseAssets({ manifestPath: validManifest, artifactsPath: tampered }),
    /manifest size mismatch|manifest SHA-256 mismatch/u,
  );

  const forbiddenZip = path.join(temporaryRoot, "forbidden-zip");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(forbiddenZip));
  const forbiddenManifest = await createFixture(forbiddenZip, fixture, { extraZipEntry: "src/private-app.js" });
  await expectFailure(
    () => validateReleaseAssets({ manifestPath: forbiddenManifest, artifactsPath: forbiddenZip }),
    /forbidden private-key\/source path/u,
  );

  await expectFailure(
    () => validateReleaseAssets({ manifestPath: validManifest, artifactsPath: valid, publish: true }),
    /publication requires certified-phase-8 status/u,
  );
  console.log("Fixture tests passed: manifest certification and immutable publication target enforced; valid inventory accepted; missing signature, tampering, forbidden source, and premature publication rejected.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
