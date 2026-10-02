# Empaqueta la app como carpeta portable con ConcursoTop3.exe, sin electron-builder.
# Uso (desde la raiz del proyecto):  npm run empaquetar
# Requisito: haber ejecutado 'npm install' (descarga el binario de Electron en node_modules\electron\dist).
param(
  [string]$Destino = '',
  [string]$ElectronDist = '',
  [switch]$Zip
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
if (-not $Destino) { $Destino = Join-Path $raiz 'dist\ConcursoTop3' }
if (-not $ElectronDist) { $ElectronDist = Join-Path $raiz 'node_modules\electron\dist' }
$electronDist = $ElectronDist
$app = Join-Path $Destino 'resources\app'

if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
  throw "No se encuentra electron.exe en '$electronDist'. Ejecuta 'npm install' primero (o indica -ElectronDist con un runtime de Electron ya extraido)."
}

if (Test-Path $Destino) { Remove-Item $Destino -Recurse -Force }
New-Item -ItemType Directory -Path $Destino -Force | Out-Null

# 1. Runtime de Electron
Copy-Item (Join-Path $electronDist '*') $Destino -Recurse -Force

# 2. Codigo de la app dentro de resources\app
New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Item (Join-Path $raiz 'main.js') $app
Copy-Item (Join-Path $raiz 'server.js') $app
Copy-Item (Join-Path $raiz 'public') (Join-Path $app 'public') -Recurse

# 3. package.json minimo (solo dependencias de produccion) e instalacion
$pkg = Get-Content (Join-Path $raiz 'package.json') -Raw | ConvertFrom-Json
$pkgApp = [ordered]@{
  name         = $pkg.name
  version      = $pkg.version
  description  = $pkg.description
  author       = $pkg.author
  private      = $true
  main         = 'main.js'
  dependencies = $pkg.dependencies
}
[IO.File]::WriteAllText((Join-Path $app 'package.json'), ($pkgApp | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding $false))

Push-Location $app
try { npm install --omit=dev --no-fund --no-audit } finally { Pop-Location }

# 4. Ejecutable renombrado
Rename-Item (Join-Path $Destino 'electron.exe') 'ConcursoTop3.exe'

if ($Zip) {
  $zipPath = "$Destino.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path $Destino -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Output "Zip generado: $zipPath"
}

Write-Output "Paquete listo en: $Destino"
