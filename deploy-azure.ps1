# Zip the app for Azure Web App deploy (replaces ngrok).
# Run from project root: .\deploy-azure.ps1
# Azure Oryx will run npm install and npm run build when you deploy this zip.
# Then upload app.zip via Azure Portal (Deployment Center > Zip Deploy) or:
#   az webapp deploy --resource-group <rg> --name glasses-demo-api-penispenis --src-path app.zip --type zip

$ErrorActionPreference = 'Stop'
$root = Get-Location
$zipPath = Join-Path $root "app.zip"

$include = @(
    'src',
    'backend',
    'server.js',
    'package.json',
    'package-lock.json',
    'next.config.ts',
    'tsconfig.json',
    '.env.example'
)
if (Test-Path (Join-Path $root 'public')) { $include += 'public' }

$items = $include | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $items -DestinationPath $zipPath -Force
Write-Host "Created $zipPath (no node_modules or .next - Azure will build on deploy)"
Write-Host "Next: Upload in Azure Portal (Deployment Center > Zip Deploy) or:"
Write-Host "  az webapp deploy --resource-group <your-rg> --name glasses-demo-api-penispenis --src-path app.zip --type zip"
