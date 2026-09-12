import { pathToFileURL } from "node:url";
import { COMMIT_SHA } from "./release-contract.mjs";

function fail(message) {
  throw new Error(`publication target: ${message}`);
}

function exactCommit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(`${label} must be an exact lowercase 40-character commit SHA`);
  }
}

export function validatePublicationTarget({ draftTarget, workflowCommit, checkoutCommit }) {
  exactCommit(workflowCommit, "workflow commit");
  exactCommit(checkoutCommit, "checked-out commit");
  exactCommit(draftTarget, "authenticated draft target");

  if (checkoutCommit !== workflowCommit) {
    fail("checked-out commit does not equal the workflow commit");
  }
  if (draftTarget !== workflowCommit) {
    fail("authenticated draft target does not equal the workflow commit");
  }
  return workflowCommit;
}

function parseArgs(argv) {
  const options = { draftTarget: null, workflowCommit: null, checkoutCommit: null };
  const names = new Map([
    ["--draft-target", "draftTarget"],
    ["--workflow-commit", "workflowCommit"],
    ["--checkout-commit", "checkoutCommit"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const property = names.get(argv[index]);
    if (!property) fail(`unknown argument: ${argv[index]}`);
    if (index + 1 >= argv.length) fail(`${argv[index]} requires a value`);
    if (options[property] !== null) fail(`${argv[index]} may be supplied only once`);
    options[property] = argv[++index];
  }
  for (const [argument, property] of names) {
    if (options[property] === null) fail(`${argument} is required`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    const commit = validatePublicationTarget(parseArgs(process.argv.slice(2)));
    console.log(`Validated authenticated draft target at exact checked-out commit ${commit}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
