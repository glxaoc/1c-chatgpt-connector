// Запускает MCP-сервер 1С для настольного приложения ChatGPT (Codex): достаёт сохранённые настройки и стартует server/index.js.
// Ничего не пишет в stdout, кроме протокола MCP: сообщения об ошибках идут в stderr.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSettings, settingsPath } from "./settings.js";

const here = path.dirname(fileURLToPath(import.meta.url));

let config;
try { config = readSettings(settingsPath()); }
catch (e) { console.error(String(e.message || e)); process.exit(1); }

const child = spawn(process.execPath, [path.join(here, "server", "index.js")], {
  cwd: here,
  env: { ...process.env, ...config },
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (e) => { console.error("Не удалось запустить сервер 1С: " + e.message); process.exit(1); });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
