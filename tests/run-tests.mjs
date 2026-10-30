// Запуск: npm test. Поднимает имитацию 1С и SSH-сервера и гоняет сценарии.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const run = (f, env = {}) => spawn(process.execPath, [f], { cwd: dir, env: { ...process.env, ...env }, stdio: "ignore" });
const k = run("mockssh2.mjs", { KEYFILE: path.join(dir, "hostkey2"), PORT: "2225", MODE: "keyonly" });
const m = run("mock1c2.mjs"); const s = run("mockssh2.mjs", { KEYFILE: path.join(dir, "hostkey1") });
await new Promise((r) => setTimeout(r, 1500));
const t = spawn(process.execPath, ["suite.mjs"], { cwd: dir, stdio: "inherit" });
t.on("exit", (code) => { m.kill(); s.kill(); k.kill(); process.exit(code ?? 0); });
