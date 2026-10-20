<#
  Instala (ou remove com -Remove) o início automático do Portal IA no login do Windows.
  Cria "Portal IA.lnk" na pasta Inicializar, que executa wscript.exe com um .vbs gerado;
  o .vbs roda `node dist\server\index.js --no-open` com janela oculta, na pasta do repositório.
  Requer `npm run build` antes (gera dist\server\index.js).
#>
param(
  [switch]$Remove,
  [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
  [string]$VbsDir = (Join-Path ($(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP })) 'portal-ia')
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lnk = Join-Path $StartupDir 'Portal IA.lnk'
$vbs = Join-Path $VbsDir 'autostart.vbs'

if ($Remove) {
  foreach ($f in @($lnk, $vbs)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }
  Write-Host "Início automático removido ($lnk)."
  exit 0
}

$entry = Join-Path $repo 'dist\server\index.js'
if (-not (Test-Path -LiteralPath $entry)) { throw "Não encontrei $entry. Rode 'npm run build' primeiro." }
$node = (Get-Command node -ErrorAction Stop).Source

# Em VBScript, aspas dentro de string literal são duplicadas.
function Q([string]$s) { '""' + $s + '""' }
$cmd = (Q $node) + ' ' + (Q $entry) + ' --no-open'
$lines = @(
  'Set sh = CreateObject("WScript.Shell")',
  ('sh.CurrentDirectory = "' + $repo + '"'),
  ('sh.Run "' + $cmd + '", 0, False')
)
New-Item -ItemType Directory -Force -Path $VbsDir, $StartupDir | Out-Null
Set-Content -LiteralPath $vbs -Value $lines -Encoding Unicode

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = $repo
$s.WindowStyle = 7
$s.Description = 'Portal IA'
$s.Save()
Write-Host "Início automático instalado: $lnk"
