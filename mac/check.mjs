// Проверка связи с 1С по тем настройкам, которые записаны в config.toml (то же самое прочитает ChatGPT).
// Запуск: node check.mjs ~/.codex/config.toml
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(os.homedir(), ".codex", "config.toml");
const BEGIN = "# >>> 1c-connector (создано install-mac.sh)";
const END = "# <<< 1c-connector";

function readBlock() {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const a = lines.indexOf(BEGIN), b = lines.indexOf(END);
  if (a < 0 || b < a) throw new Error(`в ${file} не найден блок коннектора`);
  const tables = lines.filter((l) => /^\[mcp_servers\.one-c-odata\]\s*$/.test(l)).length;
  if (tables !== 1) throw new Error(`в ${file} подключение one-c-odata встречается ${tables} раз`);
  const env = {};
  let inEnv = false;
  for (const l of lines.slice(a + 1, b)) {
    if (/^\[mcp_servers\.one-c-odata\.env\]\s*$/.test(l)) { inEnv = true; continue; }
    if (/^\[/.test(l)) { inEnv = false; continue; }
    const m = l.match(/^([A-Z_0-9]+) = (".*")$/);
    if (!m) continue;
    const v = JSON.parse(m[2]); // упадёт, если строка записана с ошибкой
    if (inEnv) env[m[1]] = v;
  }
  return env;
}

let env;
try { env = readBlock(); }
catch (e) { console.log("Файл настроек записан с ошибкой: " + e.message + ". Напишите автору коннектора (https://t.me/Ioann_d) и приложите этот текст."); process.exit(1); }

const t = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, "server", "index.js")],
  env: { PATH: process.env.PATH || "", HOME: os.homedir(), ...env },
  stderr: "ignore",
});
const c = new Client({ name: "check", version: "1" });
try {
  await c.connect(t);
  const r = await c.callTool({ name: "check_connection", arguments: {} });
  const text = r.content.map((x) => x.text).join("\n").trim();
  console.log(text);
} catch (e) {
  console.log("Проверка не прошла: " + (e.message || e));
  process.exitCode = 1;
} finally {
  await c.close().catch(() => {});
}
