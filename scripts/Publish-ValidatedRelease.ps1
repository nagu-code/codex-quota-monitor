[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, [long]::MaxValue)][long]$WorkflowRunId,
  [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$WorkflowRunAttempt,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ReviewedCommit,
  [Parameter(Mandatory = $true)][string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repository = "nagu-code/codex-quota-monitor"
$releaseTag = "v1.5.0"
$releaseTitle = "Codex Quota Monitor v1.5.0"
$evidenceArtifactName = "publication-evidence-v1.5.0-attempt-$WorkflowRunAttempt"
$rulesetId = 23030280
$expectedConfirmation = "PUBLISH v1.5.0 FROM VALIDATED RUN $WorkflowRunId ATTEMPT $WorkflowRunAttempt"
$temporaryDirectory = $null
$locationPushed = $false

function Invoke-GhText {
  param(
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [string]$InputJson
  )

  if ($PSBoundParameters.ContainsKey("InputJson")) {
    $output = $InputJson | & gh @ArgumentList
  } else {
    $output = & gh @ArgumentList
  }
  if ($LASTEXITCODE -ne 0) {
    throw "gh command failed: gh $($ArgumentList -join ' ')"
  }
  return [string]::Join([Environment]::NewLine, @($output))
}

function Invoke-GhJson {
  param(
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [string]$InputJson
  )

  if ($PSBoundParameters.ContainsKey("InputJson")) {
    $text = Invoke-GhText -ArgumentList $ArgumentList -InputJson $InputJson
  } else {
    $text = Invoke-GhText -ArgumentList $ArgumentList
  }
  return $text | ConvertFrom-Json
}

function Get-DraftRelease {
  $releases = Invoke-GhJson -ArgumentList @("api", "repos/$repository/releases?per_page=100")
  $matches = @($releases | Where-Object { $_.tag_name -ceq $releaseTag })
  if ($matches.Count -ne 1) {
    throw "Exactly one authenticated $releaseTag draft release is required."
  }
  $release = $matches[0]
  if (-not $release.draft -or $release.prerelease -or $release.name -cne $releaseTitle) {
    throw "The authenticated $releaseTag release metadata is not the exact non-prerelease draft contract."
  }
  return $release
}

function Assert-CurrentDefaultBranch {
  param([Parameter(Mandatory = $true)][string]$ExpectedCommit)

  $repositoryState = Invoke-GhJson -ArgumentList @("api", "repos/$repository")
  $defaultBranch = [string]$repositoryState.default_branch
  if ([string]::IsNullOrWhiteSpace($defaultBranch)) {
    throw "The authenticated repository has no default branch."
  }
  $branch = Invoke-GhJson -ArgumentList @("api", "repos/$repository/branches/$defaultBranch")
  if (-not $branch.protected -or $branch.commit.sha -cne $ExpectedCommit) {
    throw "The reviewed commit is no longer the current protected default-branch tip."
  }
  return $defaultBranch
}

function Assert-ExactTagAbsent {
  $tagRefs = Invoke-GhJson -ArgumentList @("api", "repos/$repository/git/matching-refs/tags/$releaseTag")
  $exactTags = @($tagRefs | Where-Object { $_.ref -ceq "refs/tags/$releaseTag" })
  if ($exactTags.Count -ne 0) {
    throw "The protected $releaseTag tag already exists; publication is stopped."
  }
}

function Get-AssetFingerprint {
  param([Parameter(Mandatory = $true)]$Release)

  return (@($Release.assets | Sort-Object -Property name | ForEach-Object {
    "$($_.id)|$($_.name)|$($_.size)|$($_.updated_at)"
  }) -join "`n")
}

try {
  if ($Confirmation -cne $expectedConfirmation) {
    throw "Confirmation must be exactly: $expectedConfirmation"
  }
  if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI is required."
  }
  & gh auth status --hostname github.com *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI must be authenticated as the designated organization administrator."
  }

  $repositoryRoot = Split-Path -Parent $PSScriptRoot
  Push-Location -LiteralPath $repositoryRoot
  $locationPushed = $true

  $checkoutCommit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $checkoutCommit -cne $ReviewedCommit) {
    throw "The local checkout is not the reviewed public commit."
  }
  $worktreeStatus = & git status --porcelain
  $worktreeStatusText = [string]::Join([Environment]::NewLine, @($worktreeStatus))
  if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrEmpty($worktreeStatusText)) {
    throw "Publication requires a clean checkout of the reviewed public commit."
  }
  $defaultBranch = Assert-CurrentDefaultBranch -ExpectedCommit $ReviewedCommit

  $run = Invoke-GhJson -ArgumentList @("api", "repos/$repository/actions/runs/$WorkflowRunId")
  if ($run.status -cne "completed" -or $run.conclusion -cne "success" -or
      $run.event -cne "workflow_dispatch" -or $run.head_sha -cne $ReviewedCommit -or
      [int]$run.run_attempt -ne $WorkflowRunAttempt -or
      $run.path -cne ".github/workflows/publish-v1.5.0.yml" -or
      $run.head_branch -cne $defaultBranch -or
      $run.head_repository.full_name -cne $repository) {
    throw "The supplied workflow run is not the successful exact-commit publication validation."
  }

  $ruleset = Invoke-GhJson -ArgumentList @("api", "repos/$repository/rulesets/$rulesetId")
  $ruleTypes = @($ruleset.rules | ForEach-Object { $_.type })
  $adminBypass = @($ruleset.bypass_actors | Where-Object {
    $_.actor_type -ceq "OrganizationAdmin" -and $_.bypass_mode -ceq "always"
  })
  if ($ruleset.target -cne "tag" -or $ruleset.enforcement -cne "active" -or
      $ruleset.current_user_can_bypass -cne "always" -or $adminBypass.Count -ne 1 -or
      @($ruleset.conditions.ref_name.include).Count -ne 1 -or
      "refs/tags/v*" -notin @($ruleset.conditions.ref_name.include) -or
      @($ruleset.conditions.ref_name.exclude).Count -ne 0 -or
      @("creation", "update", "deletion", "non_fast_forward").Where({ $_ -notin $ruleTypes }).Count -ne 0) {
    throw "The authenticated account cannot use the required protected version-tag gate."
  }

  node scripts/check-public-repository.mjs
  if ($LASTEXITCODE -ne 0) { throw "Public repository policy validation failed." }
  node scripts/validate-release-manifest.mjs --manifest .github/releases/v1.5.0.json --publish
  if ($LASTEXITCODE -ne 0) { throw "Certified release manifest validation failed." }

  $release = Get-DraftRelease
  node scripts/validate-publication-target.mjs `
    --draft-target "$($release.target_commitish)" `
    --workflow-commit "$ReviewedCommit" `
    --checkout-commit "$checkoutCommit"
  if ($LASTEXITCODE -ne 0) { throw "Authenticated draft target validation failed." }
  Assert-ExactTagAbsent
  $releaseId = [long]$release.id
  $assetFingerprint = Get-AssetFingerprint -Release $release

  $temporaryDirectory = [IO.Path]::Combine(
    [IO.Path]::GetTempPath(),
    "cqm-publication-$([Guid]::NewGuid().ToString('N'))"
  )
  $artifactDirectory = Join-Path $temporaryDirectory "release-assets"
  $evidenceDirectory = Join-Path $temporaryDirectory "publication-evidence"
  New-Item -ItemType Directory -Path $artifactDirectory -Force -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $evidenceDirectory -Force -ErrorAction Stop | Out-Null
  & gh release download $releaseTag --repo $repository --dir $artifactDirectory
  if ($LASTEXITCODE -ne 0) { throw "Authenticated draft asset download failed." }

  $runArtifacts = Invoke-GhJson -ArgumentList @(
    "api", "repos/$repository/actions/runs/$WorkflowRunId/artifacts?per_page=100"
  )
  $evidenceMatches = @($runArtifacts.artifacts | Where-Object { $_.name -ceq $evidenceArtifactName })
  if ($evidenceMatches.Count -ne 1 -or $evidenceMatches[0].expired -cne $false -or
      [long]$evidenceMatches[0].id -lt 1 -or [long]$evidenceMatches[0].size_in_bytes -lt 1) {
    throw "Exactly one unexpired immutable publication evidence artifact is required from the validated run."
  }
  & gh run download $WorkflowRunId `
    --repo $repository `
    --name $evidenceArtifactName `
    --dir $evidenceDirectory
  if ($LASTEXITCODE -ne 0) { throw "Validated publication evidence download failed." }
  $expectedEvidenceFiles = @(
    "phase8-certification.json",
    "phase9-audit-one.json",
    "phase9-audit-two.json",
    "publication-binding.json"
  ) | Sort-Object
  $actualEvidenceFiles = @(
    Get-ChildItem -LiteralPath $evidenceDirectory -Force | ForEach-Object {
      if (-not $_.PSIsContainer) { $_.Name } else { "directory:$($_.Name)" }
    }
  ) | Sort-Object
  if ([string]::Join("`n", $actualEvidenceFiles) -cne [string]::Join("`n", $expectedEvidenceFiles)) {
    throw "The validated run publication evidence inventory differs."
  }
  node scripts/validate-publication-evidence.mjs `
    --manifest .github/releases/v1.5.0.json `
    --artifacts $artifactDirectory `
    --canonical-root . `
    --phase8-receipt (Join-Path $evidenceDirectory "phase8-certification.json") `
    --audit-one (Join-Path $evidenceDirectory "phase9-audit-one.json") `
    --audit-two (Join-Path $evidenceDirectory "phase9-audit-two.json") `
    --reviewed-commit $ReviewedCommit `
    --draft-release-id $releaseId `
    --binding (Join-Path $evidenceDirectory "publication-binding.json")
  if ($LASTEXITCODE -ne 0) { throw "Publication evidence or release asset validation failed." }
  & ./scripts/Test-DetachedChecksumSignature.ps1 `
    -InputPath (Join-Path $artifactDirectory "SHA256SUMS.txt") `
    -SignaturePath (Join-Path $artifactDirectory "SHA256SUMS.p7s") `
    -ExpectedThumbprint 8452BCAFAD093D33D122097AD7D112A42A26526D

  $finalRelease = Get-DraftRelease
  if ([long]$finalRelease.id -ne $releaseId -or
      (Get-AssetFingerprint -Release $finalRelease) -cne $assetFingerprint) {
    throw "The authenticated draft or its six assets changed during validation."
  }
  node scripts/validate-publication-target.mjs `
    --draft-target "$($finalRelease.target_commitish)" `
    --workflow-commit "$ReviewedCommit" `
    --checkout-commit "$checkoutCommit"
  if ($LASTEXITCODE -ne 0) { throw "Final authenticated draft target validation failed." }
  $null = Assert-CurrentDefaultBranch -ExpectedCommit $ReviewedCommit
  Assert-ExactTagAbsent

  $notes = Get-Content -Raw -LiteralPath ".github/release-notes/v1.5.0.md"
  $payload = @{
    name = $releaseTitle
    draft = $false
    prerelease = $false
    body = $notes
    make_latest = "false"
  } | ConvertTo-Json
  $published = Invoke-GhJson `
    -ArgumentList @("api", "--method", "PATCH", "repos/$repository/releases/$releaseId", "--input", "-") `
    -InputJson $payload
  if ($published.draft -or $published.prerelease -or
      $published.name -cne $releaseTitle -or $published.tag_name -cne $releaseTag -or
      $published.target_commitish -cne $ReviewedCommit) {
    throw "Publication returned an unexpected release; invoke the private release-withdrawal runbook."
  }

  $tagRef = Invoke-GhJson -ArgumentList @("api", "repos/$repository/git/ref/tags/$releaseTag")
  if ($tagRef.object.type -cne "commit" -or $tagRef.object.sha -cne $ReviewedCommit) {
    throw "The published protected tag is not the reviewed commit; invoke the private release-withdrawal runbook."
  }

  Write-Host "Published $releaseTag from validated workflow run $WorkflowRunId attempt $WorkflowRunAttempt at $ReviewedCommit."
} finally {
  if ($locationPushed) { Pop-Location }
  if ($null -ne $temporaryDirectory -and (Test-Path -LiteralPath $temporaryDirectory)) {
    $fullArtifactPath = [IO.Path]::GetFullPath($temporaryDirectory)
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd("\", "/")
    $actualParent = (Split-Path -Parent $fullArtifactPath).TrimEnd("\", "/")
    $safeName = (Split-Path -Leaf $fullArtifactPath) -match '^cqm-publication-[a-f0-9]{32}$'
    if ($actualParent -ieq $temporaryParent -and $safeName) {
      Remove-Item -LiteralPath $fullArtifactPath -Recurse -Force
    } else {
      Write-Warning "Refusing to remove unexpected temporary path: $fullArtifactPath"
    }
  }
}
