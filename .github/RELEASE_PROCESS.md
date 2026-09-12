# Public release control

The repository is prepared for `v1.5.0`, but certification is `pending-phase-8`. No installer, ZIP, tag, draft release, or public release is created by repository validation.

## Required repository settings

Before the publish workflow can be used, an organization owner must:

1. create the `production-release` GitHub environment;
2. restrict it to the protected default branch and require Nikhil K J, or a formally delegated Nagu release approver, as a reviewer;
3. restrict Actions workflow changes and final `v1.5.0` tag management to release maintainers; and
4. keep the default workflow token read-only except for the publish job's explicit `contents: write` permission.

## Phase 8 staging

After an immutable RC passes every Phase 8 gate, create the authenticated draft release outside this workflow, target the exact reviewed public commit, and upload only the six assets named in `.github/releases/v1.5.0.json`. Replace every `null` in that manifest with certified values, set `status` to `certified-phase-8`, and commit the manifest before the Phase 9 audits. Large binaries and release assets must never be committed to Git.

## Phase 9 publication

Only after two consecutive clean, fresh Phase 9 audits may an authorized publisher manually run **Publish certified v1.5.0 draft**. The two distinct audit evidence references must match the reviewed release candidate. The publisher must type the exact confirmation phrase shown by the workflow.

The workflow finds an existing draft; it cannot create a release or upload assets. It downloads the draft assets with authentication, checks the exact top-level and signed-ZIP inventories, verifies sizes and SHA-256 values against both checksum files and the manifest, rejects forbidden private-key/source paths, verifies the detached CMS signature and fixed signer thumbprint, and confirms the draft targets the certified public commit. Only then does it change that existing draft to a public release.

Anonymous download and installation checks remain a mandatory post-publication smoke gate. A failure invokes the release-withdrawal and website-rollback runbook in the private source repository.
