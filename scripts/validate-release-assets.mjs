import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import {
  ARTIFACTS,
  PRIVATE_CONTENT,
  PRIVATE_OR_SOURCE_PATH,
  SIGNED_ZIP_ENTRIES,
} from "./release-contract.mjs";
import { validateManifest } from "./validate-release-manifest.mjs";

const compareNames = (left, right) => left.localeCompare(right, "en");
const TOP_LEVEL_CHECKSUMS = ARTIFACTS
  .filter(([, listed]) => listed)
  .map(([name]) => name)
  .sort(compareNames);
const ZIP_CHECKSUMS = SIGNED_ZIP_ENTRIES
  .filter((name) => !["SHA256SUMS.txt", "SHA256SUMS.p7s"].includes(name))
  .sort(compareNames);

function fail(message) {
  throw new Error(`release assets: ${message}`);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sameInventory(actual, expected, label) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.length !== right.length || left.some((name, index) => name !== right[index])) {
    fail(`${label} must be exactly [${right.join(", ")}], found [${left.join(", ")}]`);
  }
}

function assertSafePath(name, label) {
  const portable = name.replaceAll("\\", "/");
  if (!portable || portable.startsWith("/") || portable.includes("../") || PRIVATE_OR_SOURCE_PATH.test(portable)) {
    fail(`${label} contains forbidden private-key/source path: ${name}`);
  }
}

function parseChecksums(contents, expectedNames, label) {
  const text = contents.toString("utf8");
  if (!text.endsWith("\n") || text.includes("\r")) {
    fail(`${label} must use LF-terminated lines`);
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => !line)) {
    fail(`${label} must contain non-empty canonical lines`);
  }
  const entries = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) \*([^\r\n]+)$/u.exec(line);
    if (!match) fail(`${label} contains an invalid line`);
    assertSafePath(match[2], label);
    if (entries.has(match[2])) fail(`${label} contains duplicate ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  sameInventory(entries.keys(), expectedNames, label);
  const actualNames = [...entries.keys()];
  if (actualNames.some((name, index) => name !== expectedNames[index])) {
    fail(`${label} entries must be sorted by filename`);
  }
  return entries;
}

function readZip(zipBuffer) {
  let eocd = -1;
  for (let offset = zipBuffer.length - 22; offset >= Math.max(0, zipBuffer.length - 65557); offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail("signed ZIP has no end-of-central-directory record");
  const count = zipBuffer.readUInt16LE(eocd + 10);
  const centralOffset = zipBuffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) fail("signed ZIP central directory is invalid");
    const flags = zipBuffer.readUInt16LE(offset + 8);
    const method = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const nameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localOffset = zipBuffer.readUInt32LE(offset + 42);
    if ((flags & 0x1) !== 0) fail("encrypted signed ZIP entries are not allowed");
    const name = zipBuffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assertSafePath(name, "signed ZIP");
    if (entries.has(name)) fail(`signed ZIP contains duplicate ${name}`);
    if (zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) fail(`local ZIP header is invalid for ${name}`);
    const localNameLength = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zipBuffer.subarray(dataStart, dataStart + compressedSize);
    let contents;
    if (method === 0) contents = compressed;
    else if (method === 8) contents = inflateRawSync(compressed);
    else fail(`unsupported ZIP compression method ${method} for ${name}`);
    if (contents.length !== uncompressedSize) fail(`uncompressed size mismatch for ${name}`);
    entries.set(name, contents);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inspectText(buffer, label) {
  if (PRIVATE_CONTENT.test(buffer.toString("utf8"))) fail(`${label} contains private credential/key material`);
}

async function readCanonicalFile(canonicalRoot, name) {
  const filePath = path.join(canonicalRoot, name);
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) fail(`canonical ${name} is not a regular file`);
  return readFile(filePath);
}

export async function validateReleaseAssets({
  manifestPath,
  artifactsPath,
  canonicalRoot = null,
  publish = false,
}) {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")), { publish });
  if (publish && !canonicalRoot) fail("publication requires the reviewed canonical repository root");
  const names = await readdir(artifactsPath);
  sameInventory(names, ARTIFACTS.map(([name]) => name), "top-level artifact inventory");
  for (const name of names) assertSafePath(name, "top-level artifact inventory");

  const buffers = new Map();
  for (const artifact of manifest.artifacts) {
    const filePath = path.join(artifactsPath, artifact.name);
    const info = await stat(filePath);
    if (!info.isFile()) fail(`${artifact.name} is not a regular file`);
    const buffer = await readFile(filePath);
    buffers.set(artifact.name, buffer);
    if (artifact.sizeBytes !== info.size) fail(`manifest size mismatch for ${artifact.name}`);
    if (artifact.sha256 !== sha256(buffer)) fail(`manifest SHA-256 mismatch for ${artifact.name}`);
  }

  const topSums = parseChecksums(buffers.get("SHA256SUMS.txt"), TOP_LEVEL_CHECKSUMS, "top-level SHA256SUMS.txt");
  for (const name of TOP_LEVEL_CHECKSUMS) {
    if (topSums.get(name) !== sha256(buffers.get(name))) fail(`SHA256SUMS mismatch for ${name}`);
  }
  if (manifest.signing.sha256SumsDigest !== sha256(buffers.get("SHA256SUMS.txt"))) {
    fail("manifest signing.sha256SumsDigest mismatch");
  }
  if (buffers.get("SHA256SUMS.p7s").length === 0) fail("detached SHA256SUMS.p7s is empty");

  inspectText(buffers.get("INSTALLATION.txt"), "INSTALLATION.txt");
  inspectText(buffers.get("LICENSE.txt"), "LICENSE.txt");
  inspectText(buffers.get("SHA256SUMS.txt"), "SHA256SUMS.txt");
  if (canonicalRoot) {
    for (const name of ["INSTALLATION.txt", "LICENSE.txt"]) {
      const canonical = await readCanonicalFile(canonicalRoot, name);
      if (!buffers.get(name).equals(canonical)) {
        fail(`${name} differs from the reviewed canonical repository copy`);
      }
    }
  }

  const zip = readZip(buffers.get("Nagu-Codex-Quota-Monitor-1.5.0-Locally-Signed.zip"));
  sameInventory(zip.keys(), SIGNED_ZIP_ENTRIES, "signed ZIP inventory");
  const zipSums = parseChecksums(zip.get("SHA256SUMS.txt"), ZIP_CHECKSUMS, "signed ZIP SHA256SUMS.txt");
  for (const name of ZIP_CHECKSUMS) {
    if (zipSums.get(name) !== sha256(zip.get(name))) fail(`signed ZIP checksum mismatch for ${name}`);
  }
  if (zip.get("SHA256SUMS.p7s").length === 0) fail("signed ZIP detached signature is empty");
  if (!zip.get("INSTALLATION.txt").equals(buffers.get("INSTALLATION.txt"))) fail("ZIP and top-level INSTALLATION.txt differ");
  if (!zip.get("LICENSE.txt").equals(buffers.get("LICENSE.txt"))) fail("ZIP and top-level LICENSE.txt differ");
  for (const [name, contents] of zip) {
    if (!/\.(?:exe|cer|p7s)$/iu.test(name)) inspectText(contents, `signed ZIP ${name}`);
  }

  const canonicalMessage = canonicalRoot ? ", canonical documents" : "";
  console.log(`Validated exact v${manifest.version} release inventory${canonicalMessage}, sizes, SHA-256 hashes, and detached-signature presence.`);
  return { manifest, buffers, zip };
}

function parseArgs(argv) {
  const options = { publish: false, manifestPath: null, artifactsPath: null, canonicalRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--publish") options.publish = true;
    else if (argv[index] === "--manifest") options.manifestPath = argv[++index];
    else if (argv[index] === "--artifacts") options.artifactsPath = argv[++index];
    else if (argv[index] === "--canonical-root") options.canonicalRoot = argv[++index];
    else fail(`unknown argument: ${argv[index]}`);
  }
  if (!options.manifestPath || !options.artifactsPath) fail("--manifest and --artifacts are required");
  if (options.publish && !options.canonicalRoot) fail("--canonical-root is required with --publish");
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  validateReleaseAssets(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
