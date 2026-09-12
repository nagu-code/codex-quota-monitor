import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PRIVATE_CONTENT } from "./release-contract.mjs";

const FORBIDDEN_BINARY = /\.(?:exe|msi|msix|zip|7z|rar|p7s|cer|crt|der|pfx|p12|pem|key)$/iu;
const PRIVATE_APP_PATH = /(?:^|\/)(?:\.env(?:\.|$)|auth\.json$|id_(?:rsa|dsa|ecdsa|ed25519)$|electron\/|renderer\/|src\/|node_modules\/|app\.asar(?:\.unpacked)?\/)/iu;

function trackedAndUntrackedFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  return output.toString("utf8").split("\0").filter(Boolean);
}

async function main() {
  const files = trackedAndUntrackedFiles();
  for (const file of files) {
    const portable = file.replaceAll("\\", "/");
    if (FORBIDDEN_BINARY.test(portable)) throw new Error(`release binary/key material must not be committed: ${file}`);
    if (PRIVATE_APP_PATH.test(portable)) throw new Error(`private application source/key path must not be committed: ${file}`);
    const contents = await readFile(file);
    if (contents.length <= 2_000_000 && PRIVATE_CONTENT.test(contents.toString("utf8"))) {
      throw new Error(`private credential/key marker found in ${file}`);
    }
  }
  console.log(`Public repository policy passed for ${files.length} files; no release binaries, private keys, or proprietary source paths found.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
