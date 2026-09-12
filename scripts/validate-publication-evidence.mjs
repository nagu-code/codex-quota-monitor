import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  COMMIT_SHA,
  PHASE8_EVIDENCE_KEYS,
  PHASE8_IDENTITY_KEYS,
  PRIVATE_RC_TAG,
  PUBLICATION_EVIDENCE_FILES,
  VERSION,
} from "./release-contract.mjs";
import { validateReleaseAssets } from "./validate-release-assets.mjs";

const HASH = /^[a-f0-9]{64}$/u;
const HASH_ANY_CASE = /^[A-Fa-f0-9]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/u;
const AUDIT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,127}$/u;

function fail(message) {
  throw new Error(`publication evidence: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} keys must be exactly: ${expected.join(", ")}`);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeHash(value, label) {
  if (typeof value !== "string" || !HASH_ANY_CASE.test(value)) fail(`${label} must be a SHA-256 digest`);
  return value.toUpperCase();
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readRegularFile(filePath, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular file`);
  return readFile(filePath);
}

function parseJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

export function artifactSetSha256(artifacts) {
  const canonical = artifacts
    .map((entry) => ({
      filename: entry.name,
      sizeBytes: entry.sizeBytes,
      sha256: normalizeHash(entry.sha256, `${entry.name} hash`),
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename, "en"))
    .map((entry) => `${entry.filename}\0${entry.sizeBytes}\0${entry.sha256}`)
    .join("\n");
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex").toUpperCase();
}

function validateEvidencePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || path.posix.isAbsolute(value)) {
    fail(`${label} must be a repository-relative POSIX path`);
  }
  if (value.split("/").some((part) => !part || part === "." || part === "..") || path.posix.normalize(value) !== value) {
    fail(`${label} is not canonical`);
  }
}

function validatePhase8Identity(value, label) {
  exactKeys(value, PHASE8_IDENTITY_KEYS, label);
  if (value.version !== VERSION) fail(`${label}.version must be ${VERSION}`);
  if (typeof value.rcTag !== "string" || !PRIVATE_RC_TAG.test(value.rcTag)) fail(`${label}.rcTag is invalid`);
  if (typeof value.commit !== "string" || !COMMIT_SHA.test(value.commit)) fail(`${label}.commit is invalid`);
  return {
    version: value.version,
    rcTag: value.rcTag,
    commit: value.commit,
    packageLockSha256: normalizeHash(value.packageLockSha256, `${label}.packageLockSha256`),
    provenanceSha256: normalizeHash(value.provenanceSha256, `${label}.provenanceSha256`),
    payloadManifestSha256: normalizeHash(value.payloadManifestSha256, `${label}.payloadManifestSha256`),
    artifactSetSha256: normalizeHash(value.artifactSetSha256, `${label}.artifactSetSha256`),
  };
}

function validatePhase8Receipt(receipt, manifest, receiptBytes) {
  exactKeys(receipt, ["schemaVersion", "kind", "generatedAtUtc", "status", "identity", "preview", "evidence"], "Phase 8 receipt");
  if (receipt.schemaVersion !== 1 || receipt.kind !== "phase8-certification" || receipt.status !== "passed") {
    fail("Phase 8 receipt is not a passed phase8-certification@1 document");
  }
  if (typeof receipt.generatedAtUtc !== "string" || !UTC.test(receipt.generatedAtUtc)) {
    fail("Phase 8 receipt timestamp is invalid");
  }
  const identity = validatePhase8Identity(receipt.identity, "Phase 8 receipt identity");
  exactKeys(receipt.preview, ["url", "firebaseReleaseId"], "Phase 8 receipt preview");
  if (!/^https:\/\/[^/]+--[^/]+\.web\.app\/?$/u.test(receipt.preview.url || "")) {
    fail("Phase 8 receipt preview URL is invalid");
  }
  if (typeof receipt.preview.firebaseReleaseId !== "string" || !receipt.preview.firebaseReleaseId ||
      /pending|placeholder|unknown/iu.test(receipt.preview.firebaseReleaseId)) {
    fail("Phase 8 receipt Firebase release ID is invalid");
  }
  exactKeys(receipt.evidence, PHASE8_EVIDENCE_KEYS, "Phase 8 receipt evidence");
  for (const name of PHASE8_EVIDENCE_KEYS) {
    exactKeys(receipt.evidence[name], ["path", "sha256"], `Phase 8 ${name} evidence`);
    validateEvidencePath(receipt.evidence[name].path, `Phase 8 ${name} evidence path`);
    normalizeHash(receipt.evidence[name].sha256, `Phase 8 ${name} evidence hash`);
  }

  const receiptHash = sha256(receiptBytes);
  if (manifest.certification.phase8PublicationReceiptSha256 !== receiptHash) {
    fail("Phase 8 publication receipt SHA-256 does not match the reviewed manifest");
  }
  if (identity.rcTag !== manifest.source.privateRcTag || identity.commit !== manifest.source.privateCommit) {
    fail("Phase 8 receipt private RC identity does not match the reviewed manifest");
  }
  if (identity.artifactSetSha256 !== artifactSetSha256(manifest.artifacts)) {
    fail("Phase 8 receipt artifact-set digest does not match the reviewed manifest artifacts");
  }
  return { identity, receiptHash, generatedAtUtc: receipt.generatedAtUtc };
}

function validateSignedPayloadManifest(bytes, phase8Identity) {
  const payload = parseJson(bytes, "signed payload manifest");
  exactKeys(payload, ["schemaVersion", "hashAlgorithm", "phase", "payloadRoot", "source", "files"], "signed payload manifest");
  if (payload.schemaVersion !== 1 || payload.hashAlgorithm !== "SHA-256" ||
      payload.phase !== "pre-signing" || payload.payloadRoot !== "resources") {
    fail("signed payload manifest contract differs");
  }
  exactKeys(payload.source, [
    "commit", "releaseCandidateTags", "packageLockSha256", "nodeVersion",
    "electronVersion", "electronBuilderVersion",
  ], "signed payload manifest source");
  if (payload.source.commit !== phase8Identity.commit ||
      !Array.isArray(payload.source.releaseCandidateTags) ||
      payload.source.releaseCandidateTags.length !== 1 ||
      payload.source.releaseCandidateTags[0] !== phase8Identity.rcTag ||
      normalizeHash(payload.source.packageLockSha256, "signed payload package-lock hash") !== phase8Identity.packageLockSha256) {
    fail("signed payload manifest does not bind the Phase 8 private RC identity");
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0) fail("signed payload manifest files are missing");
  const names = new Set();
  let previous = null;
  for (const [index, entry] of payload.files.entries()) {
    exactKeys(entry, ["path", "size", "sha256"], `signed payload files[${index}]`);
    validateEvidencePath(entry.path, `signed payload files[${index}].path`);
    if (names.has(entry.path)) fail(`signed payload manifest duplicates ${entry.path}`);
    if (previous !== null && previous.localeCompare(entry.path, "en") > 0) {
      fail("signed payload manifest files must be sorted by path");
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 1) fail(`signed payload ${entry.path} size is invalid`);
    normalizeHash(entry.sha256, `signed payload ${entry.path} hash`);
    names.add(entry.path);
    previous = entry.path;
  }
  if (sha256(bytes).toUpperCase() !== phase8Identity.payloadManifestSha256) {
    fail("signed payload manifest digest does not match the Phase 8 identity");
  }
}

function validateAuditReceipt(receipt, label) {
  exactKeys(receipt, ["schemaVersion", "kind", "status", "audit", "phase8Identity", "publication"], label);
  if (receipt.schemaVersion !== 1 || receipt.kind !== "phase9-audit-receipt" || receipt.status !== "clean") {
    fail(`${label} is not a clean phase9-audit-receipt@1 document`);
  }
  exactKeys(receipt.audit, [
    "sequence", "auditId", "auditorId", "completedAtUtc", "previousAuditReceiptSha256",
  ], `${label} audit`);
  if (![1, 2].includes(receipt.audit.sequence)) fail(`${label} sequence must be 1 or 2`);
  for (const name of ["auditId", "auditorId"]) {
    if (typeof receipt.audit[name] !== "string" || !AUDIT_TOKEN.test(receipt.audit[name])) {
      fail(`${label} ${name} is invalid`);
    }
  }
  if (typeof receipt.audit.completedAtUtc !== "string" || !UTC.test(receipt.audit.completedAtUtc)) {
    fail(`${label} completion timestamp is invalid`);
  }
  if (receipt.audit.previousAuditReceiptSha256 !== null &&
      (typeof receipt.audit.previousAuditReceiptSha256 !== "string" || !HASH.test(receipt.audit.previousAuditReceiptSha256))) {
    fail(`${label} previous receipt hash is invalid`);
  }
  exactKeys(receipt.publication, [
    "phase8PublicationReceiptSha256", "publicReviewedCommit", "draftReleaseId",
  ], `${label} publication`);
  if (typeof receipt.publication.phase8PublicationReceiptSha256 !== "string" ||
      !HASH.test(receipt.publication.phase8PublicationReceiptSha256)) {
    fail(`${label} Phase 8 receipt hash is invalid`);
  }
  if (typeof receipt.publication.publicReviewedCommit !== "string" ||
      !COMMIT_SHA.test(receipt.publication.publicReviewedCommit)) {
    fail(`${label} reviewed public commit is invalid`);
  }
  if (!Number.isSafeInteger(receipt.publication.draftReleaseId) || receipt.publication.draftReleaseId < 1) {
    fail(`${label} draft release ID is invalid`);
  }
  return {
    audit: receipt.audit,
    phase8Identity: validatePhase8Identity(receipt.phase8Identity, `${label} Phase 8 identity`),
    publication: receipt.publication,
  };
}

function validateAuditPair({
  auditOne,
  auditOneBytes,
  auditTwo,
  phase8,
  reviewedCommit,
  draftReleaseId,
}) {
  const one = validateAuditReceipt(auditOne, "Phase 9 audit one");
  const two = validateAuditReceipt(auditTwo, "Phase 9 audit two");
  if (one.audit.sequence !== 1 || one.audit.previousAuditReceiptSha256 !== null) {
    fail("Phase 9 audit one must be sequence 1 with no previous receipt");
  }
  if (two.audit.sequence !== 2 || two.audit.previousAuditReceiptSha256 !== sha256(auditOneBytes)) {
    fail("Phase 9 audit two must chain the exact first audit receipt SHA-256");
  }
  if (one.audit.auditId === two.audit.auditId || one.audit.auditorId === two.audit.auditorId) {
    fail("Phase 9 audits must have distinct audit and auditor identities");
  }
  const phase8Time = Date.parse(phase8.generatedAtUtc);
  const oneTime = Date.parse(one.audit.completedAtUtc);
  const twoTime = Date.parse(two.audit.completedAtUtc);
  if (!(oneTime >= phase8Time && twoTime > oneTime)) {
    fail("Phase 9 audits are not consecutive after Phase 8 certification");
  }
  if (twoTime > Date.now() + 5 * 60 * 1000) fail("Phase 9 audit completion timestamp is in the future");
  for (const [label, receipt] of [["audit one", one], ["audit two", two]]) {
    if (JSON.stringify(receipt.phase8Identity) !== JSON.stringify(phase8.identity)) {
      fail(`Phase 9 ${label} does not bind the exact Phase 8 identity`);
    }
    if (receipt.publication.phase8PublicationReceiptSha256 !== phase8.receiptHash ||
        receipt.publication.publicReviewedCommit !== reviewedCommit ||
        receipt.publication.draftReleaseId !== draftReleaseId) {
      fail(`Phase 9 ${label} does not bind the exact publication target`);
    }
  }
  return { one, two };
}

function buildBinding({ phase8, auditOne, auditOneBytes, auditTwo, auditTwoBytes, reviewedCommit, draftReleaseId }) {
  return {
    schemaVersion: 1,
    kind: "publication-evidence-binding",
    phase8PublicationReceiptSha256: phase8.receiptHash,
    phase9AuditReceipts: [
      {
        sequence: 1,
        auditId: auditOne.audit.auditId,
        auditorId: auditOne.audit.auditorId,
        completedAtUtc: auditOne.audit.completedAtUtc,
        sha256: sha256(auditOneBytes),
      },
      {
        sequence: 2,
        auditId: auditTwo.audit.auditId,
        auditorId: auditTwo.audit.auditorId,
        completedAtUtc: auditTwo.audit.completedAtUtc,
        sha256: sha256(auditTwoBytes),
      },
    ],
    phase8Identity: phase8.identity,
    publication: { publicReviewedCommit: reviewedCommit, draftReleaseId },
  };
}

export async function validatePublicationEvidence({
  manifestPath,
  artifactsPath,
  canonicalRoot,
  phase8ReceiptPath,
  auditOnePath,
  auditTwoPath,
  reviewedCommit,
  draftReleaseId,
  bindingPath = null,
  bindingOutputPath = null,
}) {
  if (typeof reviewedCommit !== "string" || !COMMIT_SHA.test(reviewedCommit)) fail("reviewed public commit is invalid");
  if (!Number.isSafeInteger(draftReleaseId) || draftReleaseId < 1) fail("draft release ID is invalid");
  if (Boolean(bindingPath) === Boolean(bindingOutputPath)) {
    fail("exactly one binding input or binding output path is required");
  }
  const { manifest, zip } = await validateReleaseAssets({
    manifestPath,
    artifactsPath,
    canonicalRoot,
    publish: true,
  });
  const [phase8Bytes, auditOneBytes, auditTwoBytes] = await Promise.all([
    readRegularFile(phase8ReceiptPath, "Phase 8 publication receipt"),
    readRegularFile(auditOnePath, "Phase 9 audit one receipt"),
    readRegularFile(auditTwoPath, "Phase 9 audit two receipt"),
  ]);
  const phase8 = validatePhase8Receipt(parseJson(phase8Bytes, "Phase 8 publication receipt"), manifest, phase8Bytes);
  validateSignedPayloadManifest(zip.get("SIGNED-PAYLOAD-MANIFEST.json"), phase8.identity);
  const audits = validateAuditPair({
    auditOne: parseJson(auditOneBytes, "Phase 9 audit one receipt"),
    auditOneBytes,
    auditTwo: parseJson(auditTwoBytes, "Phase 9 audit two receipt"),
    phase8,
    reviewedCommit,
    draftReleaseId,
  });
  const binding = buildBinding({
    phase8,
    auditOne: audits.one,
    auditOneBytes,
    auditTwo: audits.two,
    auditTwoBytes,
    reviewedCommit,
    draftReleaseId,
  });
  const bindingBytes = canonicalJson(binding);
  if (bindingOutputPath) {
    await writeFile(bindingOutputPath, bindingBytes, { flag: "wx" });
  } else {
    const actualBinding = await readRegularFile(bindingPath, "publication evidence binding");
    if (!actualBinding.equals(bindingBytes)) fail("publication evidence binding is not the exact canonical binding");
  }
  console.log(`Validated two chained Phase 9 audits for ${phase8.identity.rcTag} at ${reviewedCommit}, draft ${draftReleaseId}.`);
  return binding;
}

function parseArgs(argv) {
  const names = new Map([
    ["--manifest", "manifestPath"],
    ["--artifacts", "artifactsPath"],
    ["--canonical-root", "canonicalRoot"],
    ["--phase8-receipt", "phase8ReceiptPath"],
    ["--audit-one", "auditOnePath"],
    ["--audit-two", "auditTwoPath"],
    ["--reviewed-commit", "reviewedCommit"],
    ["--draft-release-id", "draftReleaseId"],
    ["--binding", "bindingPath"],
    ["--binding-output", "bindingOutputPath"],
  ]);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const property = names.get(argv[index]);
    if (!property) fail(`unknown argument: ${argv[index]}`);
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) fail(`${argv[index]} requires a value`);
    if (Object.hasOwn(options, property)) fail(`${argv[index]} may be supplied only once`);
    options[property] = argv[++index];
  }
  for (const property of [
    "manifestPath", "artifactsPath", "canonicalRoot", "phase8ReceiptPath",
    "auditOnePath", "auditTwoPath", "reviewedCommit", "draftReleaseId",
  ]) {
    if (!Object.hasOwn(options, property)) fail(`${property} is required`);
  }
  options.draftReleaseId = Number(options.draftReleaseId);
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  validatePublicationEvidence(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { PUBLICATION_EVIDENCE_FILES };
