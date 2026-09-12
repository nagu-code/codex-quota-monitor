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

1. replace every `null` in `.github/releases/v1.5.0.json` with certified values, including the exact private RC tag, its 40-character private commit SHA, the immutable Phase 8 evidence reference, all six asset sizes and SHA-256 values, and the `SHA256SUMS.txt` digest;
2. set `status` to `certified-phase-8`, commit the manifest, and complete review on the protected default branch;
3. record the resulting reviewed public commit's full lowercase 40-character SHA; and
4. create the authenticated draft release outside the publish workflow, set `target_commitish` to that literal public commit SHA (never a branch or other mutable ref), and upload only the six assets named in the manifest.

The manifest is the Phase 8 binding to the private RC, evidence, artifact hashes, and signing identity. It deliberately does not contain its own public commit SHA, which would be a circular and impossible claim. The authenticated draft supplies the public-commit binding after the manifest commit exists. The draft must remain a draft, and the `v1.5.0` tag must not exist, throughout Phase 8. Large binaries and release assets must never be committed to Git.

## Phase 9 publication

Only after two consecutive clean, fresh Phase 9 audits may an authorized publisher manually run **Validate certified v1.5.0 draft**. The two distinct audit evidence references must match the exact private RC, Phase 8 evidence, authenticated draft, six assets, and reviewed public commit. The publisher must select the protected default branch at that same reviewed commit and type `VALIDATE v1.5.0 FOR ADMIN PUBLICATION`. If the branch or draft target moves, fresh audits are required against the new exact commit.

The read-only workflow finds an existing draft; it cannot create a release, upload assets, or create a tag. It checks that it is running from the protected default branch and that the checked-out `HEAD` equals the immutable `GITHUB_SHA`. It requires the authenticated draft's `target_commitish` to be that exact 40-character SHA, so `main` or any other mutable ref fails closed. It then downloads the draft assets with authentication, checks the exact top-level and signed-ZIP inventories, verifies sizes and SHA-256 values against both checksum files and the manifest, rejects forbidden private-key/source paths, and verifies the detached CMS signature and fixed signer thumbprint. After a final draft, target, and tag-absence check, its job summary records the successful run ID, run attempt, reviewed commit, and draft ID.

The designated organization administrator must then use a clean checkout of the recorded commit and run the parent publication command, substituting the exact values from that successful job summary:

```powershell
pwsh ./scripts/Publish-ValidatedRelease.ps1 `
  -WorkflowRunId 123456789 `
  -WorkflowRunAttempt 1 `
  -ReviewedCommit 0123456789abcdef0123456789abcdef01234567 `
  -Confirmation "PUBLISH v1.5.0 FROM VALIDATED RUN 123456789 ATTEMPT 1"
```

This script refuses a dirty or different checkout, an unsuccessful/different workflow run or attempt, a caller without the active organization-admin version-tag bypass, a changed or non-draft release, a mutable or mismatched target, changed assets, a missing signature, or a pre-existing tag. It repeats all repository, manifest, asset, signature, draft-target, and tag-absence checks immediately before one Releases API operation publishes the draft and creates the protected tag at its already-validated `target_commitish`. Organization administrators must serialize this parent step and perform no concurrent tag or release operations. A tag-protection rejection stops publication; any unexpected result after the publication call invokes the private release-withdrawal runbook.

Anonymous download and installation checks remain a mandatory post-publication smoke gate. A failure invokes the release-withdrawal and website-rollback runbook in the private source repository.
