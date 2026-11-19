// Запуск: npm test. Поднимает имитацию 1С и SSH-сервера и гоняет сценарии.
// Порты берутся свободные (или из TEST_PORT_*), поэтому два прогона рядом не мешают друг другу:
// раньше порты 8766/2224/2225 были зашиты, и соседний прогон отвечал чужой заглушкой.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
const dir = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c1test-"));

// Свободный порт: занимаем 0, берём выданный номер, отпускаем.
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.unref(); s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(String(port))); });
});
const ports = {};
for (const k of ["ODATA", "SSH", "SSH_KEY", "SSH_DEAD", "ODATA_DEAD"]) ports[k] = process.env["TEST_PORT_" + k] || await freePort();
// «Мёртвые» порты должны оставаться свободными: их никто не слушает, сервер должен получить отказ.

const procs = [];
// Заглушка готова, когда напечатала строку «… up» в stderr. Ждём её, а не фиксированную паузу.
const start = (file, env, label) => new Promise((res, rej) => {
  const p = spawn(process.execPath, [file], { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
  procs.push(p);
  let err = "";
  const t = setTimeout(() => rej(new Error(`${label} не запустилась за 10 с: ${err.slice(0, 300)}`)), 10_000);
  p.stderr.on("data", (d) => { err += d; if (/ up/.test(err)) { clearTimeout(t); res(); } });
  p.on("exit", (code) => { clearTimeout(t); rej(new Error(`${label} завершилась с кодом ${code}: ${err.slice(0, 300)}`)); });
});
const stopAll = () => { for (const p of procs) { p.removeAllListeners("exit"); p.kill(); } fs.rmSync(tmp, { recursive: true, force: true }); };

try {
  await Promise.all([
    start("mockssh2.mjs", { KEYFILE: path.join(tmp, "hostkey2"), PORT: ports.SSH_KEY, MODE: "keyonly" }, "SSH-заглушка (только ключ)"),
    start("mock1c2.mjs", { PORT: ports.ODATA }, "заглушка 1С"),
    start("mockssh2.mjs", { KEYFILE: path.join(tmp, "hostkey1"), PORT: ports.SSH }, "SSH-заглушка"),
  ]);
} catch (e) { console.error("❌ " + e.message); stopAll(); process.exit(1); }

const env = { ...process.env };
for (const [k, v] of Object.entries(ports)) env["TEST_PORT_" + k] = v;
const t = spawn(process.execPath, ["suite.mjs"], { cwd: dir, stdio: "inherit", env });
t.on("exit", (code) => { stopAll(); process.exit(code ?? 1); });
