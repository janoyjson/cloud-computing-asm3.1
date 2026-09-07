$ErrorActionPreference = 'Stop'

$apiDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspaceDirectory = (Resolve-Path (Join-Path $apiDirectory '..\..')).Path
$bundlePath = Join-Path $apiDirectory 'dist-lambda\index.js'
$packageSourcePath = Join-Path $apiDirectory 'lambda-package.json'
$packageBundlePath = Join-Path $apiDirectory 'dist-lambda\package.json'
$artifactDirectory = Join-Path $workspaceDirectory 'artifacts'
$zipPath = Join-Path $artifactDirectory 'cloudsentinel-api.zip'

if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
  throw "Lambda bundle not found at $bundlePath"
}

Copy-Item -LiteralPath $packageSourcePath -Destination $packageBundlePath -Force
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
Compress-Archive -LiteralPath @($bundlePath, $packageBundlePath) -DestinationPath $zipPath -Force

Write-Output "Created $zipPath"
