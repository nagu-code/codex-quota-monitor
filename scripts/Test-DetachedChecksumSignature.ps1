param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$SignaturePath,
  [Parameter(Mandatory = $true)][string]$ExpectedThumbprint
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$content = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $InputPath).Path)
$signature = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $SignaturePath).Path)
$contentInfo = [System.Security.Cryptography.Pkcs.ContentInfo]::new($content)
$signedCms = [System.Security.Cryptography.Pkcs.SignedCms]::new($contentInfo, $true)
$signedCms.Decode($signature)
$signedCms.CheckSignature($true)

if ($signedCms.SignerInfos.Count -ne 1) {
  throw "Detached signature must contain exactly one signer."
}

$signer = $signedCms.SignerInfos[0]
$expected = ($ExpectedThumbprint -replace "[^A-Fa-f0-9]", "").ToUpperInvariant()
$actual = $signer.Certificate.Thumbprint.ToUpperInvariant()
if ($actual -cne $expected) {
  throw "Detached signature signer mismatch."
}
if ($signer.DigestAlgorithm.Value -cne "2.16.840.1.101.3.4.2.1") {
  throw "Detached signature must use SHA-256."
}

Write-Host "Detached SHA256SUMS signature and signer thumbprint verified."
