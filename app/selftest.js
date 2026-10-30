// Самопроверка: запускает сервер так же, как приложение, и вызывает check_connection. Код выхода 0 при успехе.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "1c-selftest", version: "1" });
const timer = setTimeout(() => { console.log("❌ Проверка не завершилась за 90 секунд. Проверьте адрес 1С и доступ к серверу."); process.exit(2); }, 90_000);
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, "launcher.js")], env: { ...process.env }, stderr: "pipe" }));
  const res = await client.callTool({ name: "check_connection", arguments: {} });
  const text = res.content?.[0]?.text || "";
  console.log(text);
  clearTimeout(timer);
  await client.close();
  process.exit(text.includes("Готово") ? 0 : 2);
} catch (e) {
  console.log("❌ Сервер 1С не запустился: " + (e?.message || e));
  process.exit(2);
}
