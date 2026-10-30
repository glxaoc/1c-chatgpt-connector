<#
  1С-коннектор для настольного приложения ChatGPT (Codex): установка и удаление.
  Запускается через INSTALL.bat. Параметры нужны только для автоматической проверки.
#>
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$Yes,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA '1c-connector'),
  [string]$SettingsDir = (Join-Path $env:APPDATA '1c-connector'),
  [string]$ConfigToml = (Join-Path $env:USERPROFILE '.codex\config.toml'),
  [string]$ODataUrl, [string]$ODataUser, [string]$ODataPasswordPlain, [string]$Description,
  [string]$SshHost, [string]$SshUser, [string]$SshPasswordPlain, [string]$SshKey,
  [switch]$NoSelfTest
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$packageRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$defaultSettingsDir = Join-Path $env:APPDATA '1c-connector'
$settingsFile = Join-Path $SettingsDir 'settings.xml'

function Say([string]$t, [string]$color = 'Gray') { Write-Host $t -ForegroundColor $color }
function Step([string]$t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Encrypt-Plain([string]$plain) {
  if ([string]::IsNullOrEmpty($plain)) { return '' }
  return (ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString)
}
function Encrypt-Secure([securestring]$sec) {
  if ($null -eq $sec -or $sec.Length -eq 0) { return '' }
  return (ConvertFrom-SecureString $sec)
}
function Assert-OwnDir([string]$dir) {
  if ((Split-Path -Leaf $dir) -ne '1c-connector') { throw "Папка установки должна называться 1c-connector: $dir" }
}
function Toml-Str([string]$s) {
  if ($s -notmatch "'") { return "'" + $s + "'" }
  return '"' + (($s -replace '\\', '\\') -replace '"', '\"') + '"'
}
function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}
function Node-Major([string]$node) {
  try { return [int](((& $node --version) -replace '^v', '').Split('.')[0]) } catch { return 0 }
}

# Убирает из config.toml наш блок и старые записи one-c-odata вместе с их подтаблицами. Остальной текст не трогает.
function Remove-OurBlock([string]$text) {
  $nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }
  $out = New-Object 'System.Collections.Generic.List[string]'
  $skip = $false
  foreach ($line in ($text -split '\r?\n')) {
    if ($line -match '^\s*#\s*1c-connector') { continue }
    if ($line -match '^\s*\[\s*mcp_servers\.("?)one-c-odata\1(\..*)?\s*\]\s*(#.*)?$') { $skip = $true; continue }
    if ($line -match '^\s*\[') { $skip = $false }
    if (-not $skip) { $out.Add($line) }
  }
  $res = ($out -join $nl).TrimEnd()
  if ($res.Length -eq 0) { return '' }
  return $res + $nl
}
function Write-NoBom([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
function Update-Config([string]$nodePath, [string]$launcherPath) {
  $dir = Split-Path -Parent $ConfigToml
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $text = ''
  if (Test-Path $ConfigToml) {
    $text = [IO.File]::ReadAllText($ConfigToml, [Text.Encoding]::UTF8)
    $bak = $ConfigToml + '.bak-1c'
    if (-not (Test-Path $bak)) { Copy-Item -LiteralPath $ConfigToml -Destination $bak }
  }
  $nl = if ($text -match "`r`n") { "`r`n" } else { "`n" }
  $text = Remove-OurBlock $text
  $lines = @(
    '',
    '# 1c-connector: подключение к 1С (создано установщиком, удаляется через installer\UNINSTALL.bat)',
    '[mcp_servers.one-c-odata]',
    ('command = ' + (Toml-Str $nodePath)),
    ('args = [' + (Toml-Str $launcherPath) + ']'),
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 120',
    'default_tools_approval_mode = "writes"'
  )
  if ($SettingsDir -ne $defaultSettingsDir) {
    $lines += '[mcp_servers.one-c-odata.env]'
    $lines += ('ONEC_SETTINGS = ' + (Toml-Str $settingsFile))
  }
  $new = $text + ($lines -join $nl) + $nl
  Write-NoBom $ConfigToml $new
}

try {
  # ---------- удаление ----------
  if ($Uninstall) {
    if (-not $Yes) {
      Write-Host ''
      Say 'Это УДАЛЕНИЕ коннектора 1С (если хотите установить, закройте окно и запустите INSTALL.bat).' 'Yellow'
      if ((Read-Host 'Удалить коннектор и сохранённые пароли? Введите YES и Enter') -ne 'YES') { Say 'Отменено, ничего не удалено.'; exit 0 }
    }
    Step 'Удаляю 1С-коннектор'
    if (Test-Path $ConfigToml) {
      $t = [IO.File]::ReadAllText($ConfigToml, [Text.Encoding]::UTF8)
      Write-NoBom $ConfigToml (Remove-OurBlock $t)
      Say 'Запись удалена из настроек приложения.'
    }
    Assert-OwnDir $InstallDir
    if (Test-Path $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
    if (Test-Path $settingsFile) { Remove-Item -LiteralPath $settingsFile -Force }
    Say 'Файлы и сохранённые пароли удалены.' 'Green'
    Say 'Перезапустите приложение ChatGPT, чтобы изменения вступили в силу.'
    exit 0
  }

  Write-Host ''
  Say '1С-коннектор для приложения ChatGPT (Codex)' 'White'
  Say 'Коннектор только читает данные. Изменить что-то в 1С через него нельзя.'

  # ---------- Node.js ----------
  Step '[1/5] Проверяю Node.js'
  $node = Find-Node
  if ($node -and (Node-Major $node) -lt 18) { Say "Найден старый Node.js ($node), нужна версия 18 или новее." 'Yellow'; $node = $null }
  if (-not $node) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
      $a = Read-Host 'Node.js не найден. Установить сейчас через Windows (winget)? Enter = да, n = нет'
      if ($a -notmatch '^(n|н)') {
        & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        $node = Find-Node
      }
    }
    if (-not $node) { throw 'Нужен Node.js 18 или новее. Скачайте его на https://nodejs.org (кнопка LTS), установите и запустите INSTALL.bat снова.' }
  }
  Say "Node.js найден: $node" 'Green'

  # ---------- данные ----------
  Step '[2/5] Данные для подключения'
  $isAuto = $PSBoundParameters.ContainsKey('ODataUrl')
  $pwEnc = ''; $sshPwEnc = ''
  if (-not $isAuto) {
    Say 'Адрес, логин и пароль пришлёт тот, кто обслуживает вашу 1С. Пользователь должен быть только на чтение.'
    $ODataUrl = Read-Host 'Адрес OData (например http://server/base/odata/standard.odata/)'
    $ODataUser = Read-Host 'Логин 1С'
    $pwEnc = Encrypt-Secure (Read-Host 'Пароль 1С (при вводе не показывается)' -AsSecureString)
    $Description = Read-Host 'Описание базы одной фразой, например «УТ 11, оптовая торговля» (Enter = пропустить)'
    Write-Host ''
    Say 'Если 1С пускает только IP из белого списка, нужен сервер-посредник с этим IP. Если 1С открыта для вашего компьютера, просто нажмите Enter.'
    $SshHost = Read-Host 'Сервер-посредник (IP, порт если не 22: 203.0.113.10:2222)'
    if ($SshHost) {
      $SshUser = Read-Host 'Логин на сервере (лучше отдельный, не root)'
      $sshPwEnc = Encrypt-Secure (Read-Host 'Пароль на сервере (Enter, если вход по ключу)' -AsSecureString)
      $SshKey = (Read-Host 'Файл приватного ключа (Enter, если вход по паролю)').Trim('"', ' ')
    }
  } else {
    $pwEnc = Encrypt-Plain $ODataPasswordPlain
    $sshPwEnc = Encrypt-Plain $SshPasswordPlain
  }
  $ODataUrl = "$ODataUrl".Trim()
  if (-not $ODataUrl) { throw 'Не указан адрес OData.' }
  if ($ODataUrl -match '^http://' -and $ODataUrl -notmatch '^http://(localhost|127\.|10\.|192\.168\.)') {
    Say 'Внимание: адрес начинается с http://, пароль 1С будет идти по сети без шифрования. Для постоянной работы попросите настроить https.' 'Yellow'
  }

  # ---------- файлы ----------
  Step '[3/5] Копирую файлы'
  Assert-OwnDir $InstallDir
  $src = Join-Path $packageRoot 'app'
  if (-not (Test-Path (Join-Path $src 'launcher.js'))) { throw 'В папке нет файлов программы. Распакуйте архив целиком и запустите INSTALL.bat снова.' }
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  & robocopy $src $InstallDir /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Не удалось скопировать файлы в $InstallDir (код $LASTEXITCODE)." }
  Say "Программа установлена в $InstallDir" 'Green'

  # ---------- настройки ----------
  Step '[4/5] Сохраняю настройки и подключаю к приложению'
  New-Item -ItemType Directory -Path $SettingsDir -Force | Out-Null
  [pscustomobject]@{
    ODataUrl = $ODataUrl; ODataUsername = "$ODataUser".Trim(); ODataPassword = $pwEnc
    Description = "$Description".Trim()
    SshHost = "$SshHost".Trim(); SshUser = "$SshUser".Trim(); SshPassword = $sshPwEnc; SshKeyPath = "$SshKey".Trim()
    AllowSelfSigned = ''
  } | Export-Clixml -LiteralPath $settingsFile
  Say 'Пароли сохранены в зашифрованном виде, расшифровать их может только ваша учётная запись Windows.' 'Green'
  Update-Config $node (Join-Path $InstallDir 'launcher.js')
  Say "Запись добавлена в $ConfigToml" 'Green'
  if (Test-Path ($ConfigToml + '.bak-1c')) { Say 'Копия прежних настроек приложения: config.toml.bak-1c' }

  # ---------- проверка ----------
  if (-not $NoSelfTest) {
    Step '[5/5] Проверяю связь с 1С'
    $env:ONEC_SETTINGS = $settingsFile
    $out = & $node (Join-Path $InstallDir 'selftest.js') 2>&1 | Out-String
    $code = $LASTEXITCODE
    $out = $out.Replace('✅', '[OK]').Replace('❌', '[ОШИБКА]').Replace('⚠️', '[!]').Replace('ℹ️', '[i]').Replace('▶', '>')
    Write-Host $out.TrimEnd()
    Write-Host ''
    if ($code -eq 0) { Say 'Связь с 1С работает.' 'Green' }
    else { Say 'Связь с 1С не установилась. Причина указана выше. Исправьте данные и запустите INSTALL.bat снова: приложение подключено, ошибка только в доступе к 1С.' 'Yellow' }
  }

  Write-Host ''
  Say 'Готово. Теперь:' 'White'
  Say '  1. Полностью закройте приложение ChatGPT (в том числе значок у часов) и откройте снова.'
  Say '  2. Напишите в чате: «Проверь связь с 1С».'
  Write-Host ''
  Say 'Удалить коннектор: папка installer, файл UNINSTALL.bat.'
  Write-Host ''
  Say 'Чего нет в бесплатной версии: запись в 1С, работа для команды, регулярные отчёты, CRM и реклама в одном чате с 1С.' 'Gray'
  Say 'Это делает под ключ автор коннектора. Написать: https://t.me/Ioann_d?text=1c-installer%20(chatgpt)%3A%20' 'Gray'
  Say 'Кейсы и новые функции: https://t.me/+mAXow6pxYwIyODJi' 'Gray'
  exit 0
}
catch {
  Write-Host ''
  Write-Host ('[ОШИБКА] ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
