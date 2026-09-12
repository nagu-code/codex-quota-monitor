# Public release control

The repository is prepared for `v1.5.0`, but certification is `pending-phase-8`. No installer, ZIP, tag, draft release, or public release is created by repository validation.

## Required repository settings

Before the publish workflow can be used, an organization owner must:

1. create the `production-release` GitHub environment;
2. restrict it to the protected default branch and require Nikhil K J, or a formally delegated Nagu release approver, as a reviewer;
3. protect `v1.5.0` tag creation, update, and deletion with the version-tag ruleset, whose only bypass role is organization administrator;
4. keep the default workflow token read-only and restrict Actions workflow changes to release maintainers; and
5. require the final parent publication command to run from an ephemeral or existing authenticated `gh` session belonging to the designated organization administrator. Do not store that credential in Actions.

## Phase 8 staging

After an immutable RC passes every Phase 8 gate:

1. retain the exact generated `release/certification/phase8-certification.json` as the sanitized Phase 8 publication receipt, calculate the SHA-256 of its exact bytes, and do not edit or reserialize it;
2. replace every `null` in `.github/releases/v1.5.0.json` with certified values, including the exact private RC tag, its 40-character private commit SHA, the lowercase Phase 8 publication-receipt SHA-256, all six asset sizes and SHA-256 values, and the `SHA256SUMS.txt` digest;
3. set `status` to `certified-phase-8`, commit the manifest, and complete review on the protected default branch;
4. record the resulting reviewed public commit's full lowercase 40-character SHA; and
5. create the authenticated draft release outside the publish workflow with the exact title `Codex Quota Monitor v1.5.0`, leave `prerelease` false, set `target_commitish` to that literal public commit SHA (never a branch or other mutable ref), and upload only the six assets named in the manifest.

The manifest hashes the exact Phase 8 certificate instead of accepting a free-form evidence label. At publication validation, the certificate's existing seven-field identity (`version`, `rcTag`, `commit`, `packageLockSha256`, `provenanceSha256`, `payloadManifestSha256`, and `artifactSetSha256`) is compared with the manifest, the exact six-artifact set, and the signed bundle's real `SIGNED-PAYLOAD-MANIFEST.json` schema. The certificate and its evidence paths must remain sanitized as required by the private Phase 8 generator; do not place secrets or machine-absolute paths in workflow inputs.

The manifest deliberately does not contain its own public commit SHA, which would be circular. The authenticated draft supplies that binding after the manifest commit exists. The draft must retain its exact title, remain a non-prerelease draft, and the `v1.5.0` tag must not exist throughout Phase 8. Large binaries, release assets, and evidence receipts must never be committed to Git.

## Phase 9 publication

Only after two consecutive clean, fresh Phase 9 audits may an authorized publisher manually run **Validate certified v1.5.0 draft**. Free-form audit references are not accepted. Each audit must emit an immutable UTF-8 JSON receipt matching `.github/phase9-audit-receipt.schema.json` and these exact root fields:

- `schemaVersion: 1`, `kind: "phase9-audit-receipt"`, and `status: "clean"`;
- `audit`: `sequence`, unique `auditId`, unique `auditorId`, UTC `completedAtUtc`, and `previousAuditReceiptSha256`;
- `phase8Identity`: the exact seven fields from the hashed Phase 8 certificate; and
- `publication`: `phase8PublicationReceiptSha256`, `publicReviewedCommit`, and numeric `draftReleaseId`.

Audit one uses sequence `1` and a null previous hash. Audit two uses sequence `2` and its previous hash is the lowercase SHA-256 of audit one's exact file bytes. Both audits must be later than the Phase 8 certificate, the second must be later than the first, their audit and auditor identities must differ, and every Phase 8/publication identity value must match exactly.

Base64-encode the exact Phase 8 certificate and both exact audit receipt files for the three workflow inputs. Base64 is only transport encoding; the decoded bytes are hash-validated and parsed as JSON. For example:

```powershell
$phase8Base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Phase8CertificatePath))
$auditOneBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($AuditOnePath))
$auditTwoBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($AuditTwoPath))
```

The publisher must select the protected default branch at the reviewed commit and type `VALIDATE v1.5.0 FOR ADMIN PUBLICATION`. If its tip or the draft target moves, fresh audits are required against the new exact commit and draft.

The validation workflow finds an existing draft; it cannot create a release, publish it, upload release assets, or create a tag. It checks that it is running at the current protected default-branch tip and that checked-out `HEAD` equals immutable `GITHUB_SHA`. It requires the exact non-prerelease draft title and literal 40-character `target_commitish`. It downloads the six draft assets, enforces canonical LF-sorted checksum lines, exact inventories, sizes, hashes, the reviewed checkout's exact `INSTALLATION.txt`/`LICENSE.txt` bytes, and the fixed detached signer.

The workflow decodes and validates the three receipts, including the Phase 8 certificate hash, full shared identity, signed payload manifest, chained distinct clean audits, public commit, draft ID and artifact-set digest. It then stores only those sanitized receipt bytes plus a canonical binding in the immutable, seven-day `publication-evidence-v1.5.0-attempt-N` workflow artifact. This Actions artifact is not a GitHub Release asset and grants no content-write permission. Afterward, a final step rechecks draft metadata and asset fingerprint, exact target, tag absence, and the still-current protected default-branch tip. Failed runs and their artifacts cannot authorize publication.

The designated organization administrator must then use a clean checkout of the recorded commit and run the parent publication command, substituting the exact values from that successful job summary:

```powershell
pwsh ./scripts/Publish-ValidatedRelease.ps1 `
  -WorkflowRunId 123456789 `
  -WorkflowRunAttempt 1 `
  -ReviewedCommit 0123456789abcdef0123456789abcdef01234567 `
  -Confirmation "PUBLISH v1.5.0 FROM VALIDATED RUN 123456789 ATTEMPT 1"
```

This script refuses a dirty or different checkout, a stale default-branch tip, an unsuccessful/different workflow run or attempt, a missing/expired/ambiguous publication-evidence artifact, a caller without the exact active organization-admin version-tag bypass, a changed or incorrectly titled/prerelease draft, a mutable or mismatched target, changed assets, changed canonical documents, invalid receipt bindings, a missing signature, or a pre-existing tag. It downloads the immutable workflow artifact, revalidates the exact receipt bytes locally without private-repository access, and repeats all repository, manifest, asset, signature, draft-target, branch-tip and tag-absence checks immediately before one Releases API operation explicitly sets `draft=false` and `prerelease=false`. Organization administrators must serialize this parent step and perform no concurrent tag or release operations. A tag-protection rejection stops publication; any unexpected result after the publication call invokes the private release-withdrawal runbook.

ZIP central-directory order is deliberately non-contractual because it has no semantic meaning. The exact signed-ZIP filename set is contractual. Both internal and top-level `SHA256SUMS.txt` files, however, must contain exactly the expected LF-terminated entries in locale-stable filename order.

Anonymous download and installation checks remain a mandatory post-publication smoke gate. A failure invokes the release-withdrawal and website-rollback runbook in the private source repository.
