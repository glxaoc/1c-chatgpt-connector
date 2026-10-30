// Чтение сохранённых настроек 1С. Пароли зашифрованы средствами Windows (DPAPI) под учётную запись пользователя.
// Работает через встроенный powershell.exe (есть на любой Windows), PowerShell 7 не нужен.
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

export function settingsPath() {
  if (process.env.ONEC_SETTINGS) return process.env.ONEC_SETTINGS;
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "1c-connector", "settings.xml");
}

const READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$x = Import-Clixml -LiteralPath $env:ONEC_SETTINGS_FILE
function Plain($v) {
  if ([string]::IsNullOrEmpty($v)) { return '' }
  $s = ConvertTo-SecureString $v
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
$o = [ordered]@{
  ODATA_URL = [string]$x.ODataUrl
  ODATA_USERNAME = [string]$x.ODataUsername
  ODATA_PASSWORD = (Plain $x.ODataPassword)
  DB_DESCRIPTION = [string]$x.Description
  SSH_HOST = [string]$x.SshHost
  SSH_USER = [string]$x.SshUser
  SSH_PASSWORD = (Plain $x.SshPassword)
  SSH_KEY_PATH = [string]$x.SshKeyPath
  ALLOW_SELF_SIGNED = [string]$x.AllowSelfSigned
}
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Compress)))
`;

export function readSettings(file = settingsPath()) {
  const root = process.env.SystemRoot || "C:\\Windows";
  const ps = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const encoded = Buffer.from(READ_SCRIPT, "utf16le").toString("base64");
  const res = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, ONEC_SETTINGS_FILE: file },
  });
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : String(res.stderr || "").split("\n")[0].trim();
    throw new Error(`Не удалось прочитать настройки 1С (${file}). Запустите INSTALL.bat заново.${why ? " Причина: " + why : ""}`);
  }
  const last = String(res.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
  try { return JSON.parse(Buffer.from(last, "base64").toString("utf8")); }
  catch { throw new Error("Файл настроек 1С повреждён. Запустите INSTALL.bat заново."); }
}
