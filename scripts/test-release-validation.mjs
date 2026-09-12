import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACTS,
  PHASE8_EVIDENCE_KEYS,
  PUBLICATION_EVIDENCE_ARTIFACT_PREFIX,
  PUBLICATION_EVIDENCE_FILES,
  RELEASE_MANIFEST_KIND,
  RELEASE_MANIFEST_SCHEMA_VERSION,
  SIGNED_ZIP_ENTRIES,
} from "./release-contract.mjs";
import { validateReleaseAssets } from "./validate-release-assets.mjs";
import { validateManifest } from "./validate-release-manifest.mjs";
import { validatePublicationTarget } from "./validate-publication-target.mjs";
import {
  artifactSetSha256,
  validatePublicationEvidence,
} from "./validate-publication-evidence.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
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
    certification: { phase8PublicationReceiptSha256: null },
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
  await writeFile(manifestPath, jsonBytes(manifest));
  return manifestPath;
}

async function createPublicationEvidence({ manifestPath, root, fixture, reviewedCommit, draftReleaseId }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const identity = {
    version: "1.5.0",
    rcTag: "v1.5.0-rc.1",
    commit: "1".repeat(40),
    packageLockSha256: "2".repeat(64),
    provenanceSha256: "4".repeat(64),
    payloadManifestSha256: sha256(Buffer.from(fixture.signedZipText["SIGNED-PAYLOAD-MANIFEST.json"])).toUpperCase(),
    artifactSetSha256: artifactSetSha256(manifest.artifacts),
  };
  const phase8 = {
    schemaVersion: 1,
    kind: "phase8-certification",
    generatedAtUtc: "2026-09-12T10:00:00.000Z",
    status: "passed",
    identity,
    preview: {
      url: "https://phase8-rc-1--codex-tracker-nagu.web.app",
      firebaseReleaseId: "fixture-release-123",
    },
    evidence: Object.fromEntries(PHASE8_EVIDENCE_KEYS.map((name, index) => [name, {
      path: `output/certification/${name}.json`,
      sha256: String(index + 5).repeat(64).slice(0, 64),
    }])),
  };
  const phase8Bytes = jsonBytes(phase8);
  const phase8Hash = sha256(phase8Bytes);
  manifest.status = "certified-phase-8";
  manifest.source = { privateRcTag: identity.rcTag, privateCommit: identity.commit };
  manifest.certification.phase8PublicationReceiptSha256 = phase8Hash;
  await writeFile(manifestPath, jsonBytes(manifest));

  const publication = {
    phase8PublicationReceiptSha256: phase8Hash,
    publicReviewedCommit: reviewedCommit,
    draftReleaseId,
  };
  const auditOne = {
    schemaVersion: 1,
    kind: "phase9-audit-receipt",
    status: "clean",
    audit: {
      sequence: 1,
      auditId: "phase9-audit-fixture-one",
      auditorId: "no-context-agent-fixture-one",
      completedAtUtc: "2026-09-12T11:00:00.000Z",
      previousAuditReceiptSha256: null,
    },
    phase8Identity: identity,
    publication,
  };
  const auditOneBytes = jsonBytes(auditOne);
  const auditTwo = {
    schemaVersion: 1,
    kind: "phase9-audit-receipt",
    status: "clean",
    audit: {
      sequence: 2,
      auditId: "phase9-audit-fixture-two",
      auditorId: "no-context-agent-fixture-two",
      completedAtUtc: "2026-09-12T12:00:00.000Z",
      previousAuditReceiptSha256: sha256(auditOneBytes),
    },
    phase8Identity: identity,
    publication,
  };
  const paths = {
    phase8: path.join(root, "phase8-certification.json"),
    auditOne: path.join(root, "phase9-audit-one.json"),
    auditTwo: path.join(root, "phase9-audit-two.json"),
    binding: path.join(root, "publication-binding.json"),
  };
  await Promise.all([
    writeFile(paths.phase8, phase8Bytes),
    writeFile(paths.auditOne, auditOneBytes),
    writeFile(paths.auditTwo, jsonBytes(auditTwo)),
  ]);
  return { identity, manifest, phase8, auditOne, auditTwo, paths };
}

async function expectFailure(action, pattern) {
  await assert.rejects(action, pattern);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(path.join(repositoryRoot, "test/fixtures/release-assets.json"), "utf8"));
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cqm-release-fixture-"));

try {
  const releaseSchema = JSON.parse(await readFile(path.join(repositoryRoot, ".github/release-manifest.schema.json"), "utf8"));
  const phase9Schema = JSON.parse(await readFile(path.join(repositoryRoot, ".github/phase9-audit-receipt.schema.json"), "utf8"));
  assert.equal(releaseSchema.properties.schemaVersion.const, RELEASE_MANIFEST_SCHEMA_VERSION);
  assert.equal(phase9Schema.properties.status.const, "clean");

  const workflowSource = await readFile(path.join(repositoryRoot, ".github/workflows/publish-v1.5.0.yml"), "utf8");
  const publisherSource = await readFile(path.join(repositoryRoot, "scripts/Publish-ValidatedRelease.ps1"), "utf8");
  for (const source of [workflowSource, publisherSource]) {
    assert(source.includes(PUBLICATION_EVIDENCE_ARTIFACT_PREFIX), "publication evidence artifact prefix is not wired end to end");
    for (const name of PUBLICATION_EVIDENCE_FILES) {
      assert(source.includes(name), `${name} is not wired into the publication evidence handoff`);
    }
  }
  assert.match(workflowSource, /branches\/\$env:DEFAULT_BRANCH/u, "workflow omits current default-branch lookup");
  assert.match(workflowSource, /\$branch\.commit\.sha -cne \$env:GITHUB_SHA/u, "workflow omits exact default-branch tip binding");
  assert.match(publisherSource, /\$branch\.commit\.sha -cne \$ExpectedCommit/u, "publisher omits exact default-branch tip binding");
  assert.match(publisherSource, /prerelease = \$false/u, "publisher does not explicitly clear prerelease state");
  for (const source of [workflowSource, publisherSource]) {
    assert(source.includes("Codex Quota Monitor v1.5.0"), "exact release title is not enforced end to end");
  }

  const installationGuide = await readFile(path.join(repositoryRoot, "INSTALLATION.txt"), "utf8");
  const privacyNotice = await readFile(path.join(repositoryRoot, "PRIVACY.md"), "utf8");
  for (const [name, contents] of [["INSTALLATION.txt", installationGuide], ["PRIVACY.md", privacyNotice]]) {
    assert.match(contents, /%APPDATA%\\Codex Quota Monitor/u, `${name} omits the packaged user-data path`);
    assert.doesNotMatch(contents, /%APPDATA%\\codex-quota-monitor/u, `${name} contains the obsolete user-data path`);
  }

  const valid = path.join(temporaryRoot, "valid");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(valid));
  const validManifest = await createFixture(valid, fixture);
  await validateReleaseAssets({ manifestPath: validManifest, artifactsPath: valid });

  const fixtureManifest = JSON.parse(await readFile(validManifest, "utf8"));
  const obsoleteSchema = structuredClone(fixtureManifest);
  obsoleteSchema.schemaVersion = 1;
  assert.throws(
    () => validateManifest(obsoleteSchema),
    /schemaVersion must be 3/u,
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
  certifiedManifest.certification.phase8PublicationReceiptSha256 = "a".repeat(64);
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
  await mkdir(missingSignature);
  await cp(valid, missingSignature, { recursive: true });
  await rm(path.join(missingSignature, "SHA256SUMS.p7s"));
  await expectFailure(
    () => validateReleaseAssets({ manifestPath: validManifest, artifactsPath: missingSignature }),
    /top-level artifact inventory/u,
  );

  const tampered = path.join(temporaryRoot, "tampered");
  await mkdir(tampered);
  await cp(valid, tampered, { recursive: true });
  await writeFile(path.join(tampered, "LICENSE.txt"), "tampered\n");
  await expectFailure(
    () => validateReleaseAssets({ manifestPath: validManifest, artifactsPath: tampered }),
    /manifest size mismatch|manifest SHA-256 mismatch/u,
  );

  const forbiddenZip = path.join(temporaryRoot, "forbidden-zip");
  await mkdir(forbiddenZip);
  const forbiddenManifest = await createFixture(forbiddenZip, fixture, { extraZipEntry: "src/private-app.js" });
  await expectFailure(
    () => validateReleaseAssets({ manifestPath: forbiddenManifest, artifactsPath: forbiddenZip }),
    /forbidden private-key\/source path/u,
  );

  await expectFailure(
    () => validateReleaseAssets({ manifestPath: validManifest, artifactsPath: valid, publish: true }),
    /publication requires certified-phase-8 status/u,
  );

  const reordered = path.join(temporaryRoot, "reordered-checksums");
  await mkdir(reordered);
  await cp(valid, reordered, { recursive: true });
  const reorderedSumsPath = path.join(reordered, "SHA256SUMS.txt");
  const reorderedLines = (await readFile(reorderedSumsPath, "utf8")).trimEnd().split("\n").reverse();
  const reorderedSums = Buffer.from(`${reorderedLines.join("\n")}\n`, "utf8");
  await writeFile(reorderedSumsPath, reorderedSums);
  const reorderedManifest = structuredClone(fixtureManifest);
  const reorderedEntry = reorderedManifest.artifacts.find((entry) => entry.name === "SHA256SUMS.txt");
  reorderedEntry.sizeBytes = reorderedSums.length;
  reorderedEntry.sha256 = sha256(reorderedSums);
  reorderedManifest.signing.sha256SumsDigest = sha256(reorderedSums);
  const reorderedManifestPath = path.join(temporaryRoot, "reordered.manifest.json");
  await writeFile(reorderedManifestPath, jsonBytes(reorderedManifest));
  await expectFailure(
    () => validateReleaseAssets({ manifestPath: reorderedManifestPath, artifactsPath: reordered }),
    /entries must be sorted by filename/u,
  );

  const publicationAssets = path.join(temporaryRoot, "publication-assets");
  await mkdir(publicationAssets);
  await cp(valid, publicationAssets, { recursive: true });
  const publicationManifest = path.join(temporaryRoot, "publication.manifest.json");
  await cp(validManifest, publicationManifest);
  const evidenceRoot = path.join(temporaryRoot, "publication-evidence");
  await mkdir(evidenceRoot);
  const draftReleaseId = 123456789;
  const publication = await createPublicationEvidence({
    manifestPath: publicationManifest,
    root: evidenceRoot,
    fixture,
    reviewedCommit,
    draftReleaseId,
  });
  const publicationArguments = {
    manifestPath: publicationManifest,
    artifactsPath: publicationAssets,
    canonicalRoot: publicationAssets,
    phase8ReceiptPath: publication.paths.phase8,
    auditOnePath: publication.paths.auditOne,
    auditTwoPath: publication.paths.auditTwo,
    reviewedCommit,
    draftReleaseId,
  };
  await validatePublicationEvidence({ ...publicationArguments, bindingOutputPath: publication.paths.binding });
  await validatePublicationEvidence({ ...publicationArguments, bindingPath: publication.paths.binding });

  const arbitraryAudit = path.join(evidenceRoot, "arbitrary-audit.json");
  await writeFile(arbitraryAudit, "anything\n");
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      auditOnePath: arbitraryAudit,
      bindingOutputPath: path.join(evidenceRoot, "arbitrary-binding.json"),
    }),
    /not valid JSON/u,
  );

  const dirtyAudit = path.join(evidenceRoot, "dirty-audit.json");
  await writeFile(dirtyAudit, jsonBytes({ ...publication.auditOne, status: "findings" }));
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      auditOnePath: dirtyAudit,
      bindingOutputPath: path.join(evidenceRoot, "dirty-binding.json"),
    }),
    /not a clean phase9-audit-receipt/u,
  );

  const unchainedAudit = path.join(evidenceRoot, "unchained-audit.json");
  await writeFile(unchainedAudit, jsonBytes({
    ...publication.auditTwo,
    audit: { ...publication.auditTwo.audit, previousAuditReceiptSha256: "0".repeat(64) },
  }));
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      auditTwoPath: unchainedAudit,
      bindingOutputPath: path.join(evidenceRoot, "unchained-binding.json"),
    }),
    /must chain the exact first audit receipt/u,
  );

  const duplicateAuditor = path.join(evidenceRoot, "duplicate-auditor.json");
  await writeFile(duplicateAuditor, jsonBytes({
    ...publication.auditTwo,
    audit: {
      ...publication.auditTwo.audit,
      auditorId: publication.auditOne.audit.auditorId,
    },
  }));
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      auditTwoPath: duplicateAuditor,
      bindingOutputPath: path.join(evidenceRoot, "duplicate-binding.json"),
    }),
    /distinct audit and auditor identities/u,
  );

  const wrongIdentityAudit = path.join(evidenceRoot, "wrong-identity-audit.json");
  await writeFile(wrongIdentityAudit, jsonBytes({
    ...publication.auditTwo,
    phase8Identity: { ...publication.auditTwo.phase8Identity, artifactSetSha256: "F".repeat(64) },
  }));
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      auditTwoPath: wrongIdentityAudit,
      bindingOutputPath: path.join(evidenceRoot, "wrong-identity-binding.json"),
    }),
    /does not bind the exact Phase 8 identity/u,
  );

  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      reviewedCommit: "b".repeat(40),
      bindingOutputPath: path.join(evidenceRoot, "wrong-commit-binding.json"),
    }),
    /does not bind the exact publication target/u,
  );
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      draftReleaseId: draftReleaseId + 1,
      bindingOutputPath: path.join(evidenceRoot, "wrong-draft-binding.json"),
    }),
    /does not bind the exact publication target/u,
  );

  const alteredPhase8 = path.join(evidenceRoot, "altered-phase8.json");
  await writeFile(alteredPhase8, Buffer.concat([await readFile(publication.paths.phase8), Buffer.from("\n")]));
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      phase8ReceiptPath: alteredPhase8,
      bindingOutputPath: path.join(evidenceRoot, "altered-phase8-binding.json"),
    }),
    /receipt SHA-256 does not match/u,
  );

  const canonicalMismatch = path.join(temporaryRoot, "canonical-mismatch");
  await mkdir(canonicalMismatch);
  await writeFile(path.join(canonicalMismatch, "INSTALLATION.txt"), "different reviewed instructions\n");
  await writeFile(path.join(canonicalMismatch, "LICENSE.txt"), fixture.topLevelText["LICENSE.txt"]);
  await expectFailure(
    () => validatePublicationEvidence({
      ...publicationArguments,
      canonicalRoot: canonicalMismatch,
      bindingOutputPath: path.join(evidenceRoot, "canonical-mismatch-binding.json"),
    }),
    /differs from the reviewed canonical repository copy/u,
  );

  const tamperedBinding = path.join(evidenceRoot, "tampered-binding.json");
  const binding = JSON.parse(await readFile(publication.paths.binding, "utf8"));
  binding.publication.draftReleaseId += 1;
  await writeFile(tamperedBinding, jsonBytes(binding));
  await expectFailure(
    () => validatePublicationEvidence({ ...publicationArguments, bindingPath: tamperedBinding }),
    /binding is not the exact canonical binding/u,
  );

  const mismatchedPayloadFixture = structuredClone(fixture);
  const mismatchedPayload = JSON.parse(mismatchedPayloadFixture.signedZipText["SIGNED-PAYLOAD-MANIFEST.json"]);
  mismatchedPayload.source.releaseCandidateTags = ["v1.5.0-rc.2"];
  mismatchedPayloadFixture.signedZipText["SIGNED-PAYLOAD-MANIFEST.json"] = `${JSON.stringify(mismatchedPayload)}\n`;
  const mismatchedPayloadAssets = path.join(temporaryRoot, "mismatched-payload-assets");
  await mkdir(mismatchedPayloadAssets);
  const mismatchedPayloadManifest = await createFixture(mismatchedPayloadAssets, mismatchedPayloadFixture);
  const mismatchedEvidenceRoot = path.join(temporaryRoot, "mismatched-payload-evidence");
  await mkdir(mismatchedEvidenceRoot);
  const mismatchedEvidence = await createPublicationEvidence({
    manifestPath: mismatchedPayloadManifest,
    root: mismatchedEvidenceRoot,
    fixture: mismatchedPayloadFixture,
    reviewedCommit,
    draftReleaseId,
  });
  await expectFailure(
    () => validatePublicationEvidence({
      manifestPath: mismatchedPayloadManifest,
      artifactsPath: mismatchedPayloadAssets,
      canonicalRoot: mismatchedPayloadAssets,
      phase8ReceiptPath: mismatchedEvidence.paths.phase8,
      auditOnePath: mismatchedEvidence.paths.auditOne,
      auditTwoPath: mismatchedEvidence.paths.auditTwo,
      reviewedCommit,
      draftReleaseId,
      bindingOutputPath: mismatchedEvidence.paths.binding,
    }),
    /signed payload manifest does not bind the Phase 8 private RC identity/u,
  );

  console.log("Fixture tests passed: certified receipt and chained-audit binding enforced; canonical bytes, checksum order, RC identity, publication target, and immutable binding tampering rejected.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
