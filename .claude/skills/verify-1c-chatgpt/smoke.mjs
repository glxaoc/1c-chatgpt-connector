// Дымовой прогон 1С-коннектора для ChatGPT (Codex) на подложной 1С. Запускать через verify.sh.
//
//   node smoke.mjs mcp  --out DIR                       # сервер из репо как MCP: протокол, инструменты, только чтение
//   node smoke.mjs pack --dist DIR --work DIR --out DIR # собранные ZIP: состав, установка Windows и Mac, удаление
//
// Подложная 1С живёт в этом же процессе на 127.0.0.1 со случайным портом и пишет каждый запрос.
// Наружу ничего не ходит: адрес 1С, логин и пароль фиктивные, окружение сервера собирается с нуля.
// Итог: OUT/result-<фаза>.json (каждая проверка PASS/FAIL), код возврата 0 только если всё прошло.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const phase = process.argv[2];
const arg = (k) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("out");
if (!["mcp", "pack"].includes(phase) || !OUT) { console.error("usage: node smoke.mjs mcp|pack --out DIR [--dist DIR --work DIR]"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const PKG = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const SERVER_SRC = fs.readFileSync(path.join(REPO, "server", "index.js"));
// Инструменты, которые видит ChatGPT. Новый инструмент = осознанная правка этого списка и REVIEW.md.
const EXPECTED_TOOLS = ["check_connection", "contact_author", "count", "describe_object", "list_objects", "query", "what_else"];

const results = [];
const T0 = Date.now();
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: ok ? undefined : String(detail).slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"} [${((Date.now() - T0) / 1000).toFixed(1)} с] ${name}${ok ? "" : "\n     " + String(detail).slice(0, 300).replace(/\n/g, " | ")}`);
};
const timed = (ms, p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: нет ответа за ${ms / 1000} с`)), ms))]);

// ---------- подложная 1С (OData) ----------
const USER = "verify.user", PASS = "verify-pass Смоук";
const AUTH = "Basic " + Buffer.from(`${USER}:${PASS}`, "utf8").toString("base64");
const BASE = "/ВерифБаза/odata/standard.odata";
const NAMES = ["Catalog_Номенклатура", "Catalog_Контрагенты", "Document_РеализацияТоваровУслуг", "AccumulationRegister_ТоварыНаСкладах"];
const META = `<?xml version="1.0" encoding="utf-8"?><edmx:Edmx><edmx:DataServices><Schema Namespace="StandardODATA">`
  + `<EntityType Name="Document_РеализацияТоваровУслуг"><Key><PropertyRef Name="Ref_Key"/></Key><Property Name="Ref_Key" Type="Edm.Guid" Nullable="false"/><Property Name="Number" Type="Edm.String"/><Property Name="Date" Type="Edm.DateTime"/><Property Name="Posted" Type="Edm.Boolean"/><Property Name="Контрагент_Key" Type="Edm.Guid"/><Property Name="СуммаДокумента" Type="Edm.Double"/><NavigationProperty Name="Контрагент" Relationship="x" FromRole="a" ToRole="b"/></EntityType>`
  + `<EntityType Name="Catalog_Номенклатура"><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="Description" Type="Edm.String"/></EntityType>`
  + `</Schema></edmx:DataServices></edmx:Edmx>`;
const DOCS = [1, 2, 3].map((i) => ({ Ref_Key: `00000000-0000-0000-0000-00000000000${i}`, Number: `СМ-000${i}`, Date: `2026-11-0${i}T10:00:00`, Posted: true, Контрагент_Key: "c1", СуммаДокумента: 1000 * i, "Контрагент@navigationLinkUrl": `Document_РеализацияТоваровУслуг(guid'${i}')/Контрагент` }));

function startMock() {
  const log = [];
  const send = (res, code, body, type = "application/json;charset=utf-8") => { res.writeHead(code, { "content-type": type }); res.end(body); };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = decodeURIComponent(u.pathname);
    log.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization === AUTH });
    if (req.method !== "GET") return send(res, 405, "only GET", "text/plain");
    if (!p.startsWith(BASE)) return send(res, 404, "<html>not found</html>", "text/html");
    if (req.headers.authorization !== AUTH) return send(res, 401, "unauthorized", "text/plain");
    const rest = p.slice(BASE.length).replace(/^\//, "");
    const top = Number(u.searchParams.get("$top")) || 100;
    if (rest === "") return send(res, 200, "\uFEFF" + JSON.stringify({ "odata.metadata": "x", value: NAMES.map((n) => ({ name: n, url: n })) }));
    if (rest === "$metadata") return send(res, 200, META, "application/xml");
    if (rest === "Document_РеализацияТоваровУслуг/$count") return send(res, 200, "\uFEFF3", "text/plain");
    if (rest === "Document_РеализацияТоваровУслуг") {
      const exp = u.searchParams.get("$expand") || "";
      return send(res, 200, JSON.stringify({ value: DOCS.slice(0, top).map((d) => (exp.includes("Контрагент") ? { ...d, Контрагент: { Description: "ООО Смоук" } } : d)) }));
    }
    if (rest === "AccumulationRegister_ТоварыНаСкладах/Balance()") return send(res, 200, JSON.stringify({ value: [{ Номенклатура: { Description: "Доска смоук" }, ВНаличииBalance: 12 }] }));
    if (rest === "Catalog_Номенклатура") return send(res, 200, JSON.stringify({ value: [{ Ref_Key: "n1", Description: "Доска смоук" }] }));
    return send(res, 404, JSON.stringify({ "odata.error": { message: { value: `Не найден объект ${rest}` } } }));
  });
  return new Promise((res) => srv.listen(0, "127.0.0.1", () => {
    const port = srv.address().port;
    res({ url: `http://127.0.0.1:${port}${BASE}/`, port, log, close: () => new Promise((r) => srv.close(r)) });
  }));
}

// Окружение с нуля: только системное, без переменных пользователя (в них могут быть настоящие ODATA_*).
function baseEnv(home) {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local") });
  return env;
}

async function withMcp(command, args, env, fn) {
  const c = new Client({ name: "verify-1c-chatgpt", version: "1" });
  const t = new StdioClientTransport({ command, args, env, stderr: "pipe" });
  let stderr = "";
  t.stderr?.on("data", (d) => { stderr += d; });
  try {
    await timed(30_000, c.connect(t), "запуск сервера");
    return await fn(c);
  } catch (e) {
    throw new Error(`${e.message}; stderr: ${stderr.slice(-400)}`);
  } finally { await c.close().catch(() => {}); }
}
const textOf = (r) => (r.content || []).map((x) => x.text || "").join("\n");
const call = async (c, name, a = {}) => { const r = await timed(30_000, c.callTool({ name, arguments: a }), name); return { r, err: !!r.isError, text: textOf(r) }; };

// ---------- фаза mcp ----------
async function phaseMcp() {
  const mock = await startMock();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "v1c-home-"));
  const env = { ...baseEnv(home), ODATA_URL: mock.url, ODATA_USERNAME: USER, ODATA_PASSWORD: PASS, DB_DESCRIPTION: "Смоук-база verify" };
  const serverJs = path.join(REPO, "server", "index.js");
  const transcript = [];
  try {
    await withMcp(process.execPath, [serverJs], env, async (c) => {
      const info = c.getServerVersion();
      check("initialize: имя сервера 1c-odata-connector", info?.name === "1c-odata-connector", JSON.stringify(info));
      check(`initialize: версия сервера = package.json (${PKG.version})`, info?.version === PKG.version, `${info?.version} vs ${PKG.version}`);
      check("initialize: объявлены инструменты (capabilities.tools)", !!c.getServerCapabilities()?.tools, JSON.stringify(c.getServerCapabilities()));
      const instr = c.getInstructions() || "";
      check("instructions: только чтение, запрет просить пароли, описание базы", instr.includes("только читает") && instr.includes("Никогда не проси пароли") && instr.includes("Смоук-база verify"), instr.slice(0, 200));

      const { tools } = await c.listTools();
      fs.writeFileSync(path.join(OUT, "tools.json"), JSON.stringify(tools, null, 2));
      const names = tools.map((t) => t.name).sort();
      check(`tools/list: ровно ${EXPECTED_TOOLS.length} инструментов (${EXPECTED_TOOLS.join(", ")})`, JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), names.join(","));
      const notRO = tools.filter((t) => t.annotations?.readOnlyHint !== true || t.annotations?.destructiveHint === true).map((t) => t.name);
      check("tools/list: у каждого readOnlyHint=true (README: поэтому приложение не спрашивает подтверждение)", notRO.length === 0, notRO.join(","));
      const badName = tools.filter((t) => !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)).map((t) => t.name);
      check("tools/list: имена латиницей, до 64 символов (требование OpenAI к именам функций)", badName.length === 0, badName.join(","));
      const badSchema = tools.filter((t) => t.inputSchema?.type !== "object" || !(t.description || "").trim()).map((t) => t.name);
      check("tools/list: inputSchema type=object и непустое описание", badSchema.length === 0, badSchema.join(","));

      const steps = [
        ["check_connection", {}, (x) => !x.err && x.text.includes("логин и пароль приняты") && x.text.includes("Готово") && x.text.includes("Опубликовано объектов: 4"), "check_connection: 1С отвечает, объектов 4, «Готово»"],
        ["list_objects", { contains: "реализация" }, (x) => !x.err && x.text.includes("Document_РеализацияТоваровУслуг"), "list_objects: поиск по слову находит документ"],
        ["describe_object", { object: "Document_РеализацияТоваровУслуг" }, (x) => !x.err && x.text.includes("Контрагент") && x.text.includes("СуммаДокумента"), "describe_object: поля и ссылки из $metadata"],
        ["query", { object: "Document_РеализацияТоваровУслуг", select: "Number,Date,Контрагент/Description", top: 2 }, (x) => {
          const j = JSON.parse(x.text); return !x.err && j.rows === 2 && j.data[0].Number === "СМ-0001" && x.text.includes("ООО Смоук") && !x.text.includes("navigationLinkUrl");
        }, "query: 2 строки, название контрагента вместо GUID, служебные поля вычищены"],
        ["query", { object: "AccumulationRegister_ТоварыНаСкладах/Balance()", select: "Номенклатура/Description,ВНаличииBalance" }, (x) => !x.err && x.text.includes("ВНаличииBalance") && x.text.includes("Доска смоук"), "query: остатки через Balance()"],
        ["count", { object: "Document_РеализацияТоваровУслуг" }, (x) => !x.err && JSON.parse(x.text).count === 3, "count: 3 (BOM не мешает)"],
        ["query", { object: "Catalog_НетТакого" }, (x) => x.err && x.text.includes("list_objects"), "query: неизвестный объект, isError и подсказка list_objects"],
        ["query", { object: "../../$batch" }, (x) => x.err && x.text.includes("Недопустимый"), "query: путь за пределы OData отклонён до запроса"],
        ["what_else", {}, (x) => !x.err && x.text.includes("Справка от автора") && x.text.includes("t.me/"), "what_else: витрина услуг автора"],
        ["contact_author", { task: "Подключить CRM к 1С" }, (x) => !x.err && x.text.includes("Подключить CRM") && !x.text.includes(PASS) && !x.text.includes(USER) && !x.text.includes(String(mock.port)) && !decodeURIComponent(x.text).includes(PASS), "contact_author: текст задачи есть, пароля, логина и адреса 1С нет"],
      ];
      for (const [tool, a, ok, label] of steps) {
        let x;
        try { x = await call(c, tool, a); } catch (e) { check(label, false, e.message); continue; }
        transcript.push({ tool, arguments: a, isError: x.err, text: x.text });
        const shape = Array.isArray(x.r.content) && x.r.content.length > 0 && x.r.content.every((p) => p.type === "text" && typeof p.text === "string" && p.text.length > 0);
        let good = false; try { good = ok(x); } catch (e) { good = false; x.text = `${e.message}: ${x.text}`; }
        check(label, good && shape, shape ? x.text : "content не из текстовых частей: " + JSON.stringify(x.r).slice(0, 300));
      }
    });
  } catch (e) { check("сервер стартует и отвечает по MCP (stdio)", false, e.message); }
  fs.writeFileSync(path.join(OUT, "transcript.json"), JSON.stringify(transcript, null, 2));

  // Только чтение на проводе: каждый запрос к 1С GET, с паролем, внутри публикации OData.
  fs.writeFileSync(path.join(OUT, "requests.jsonl"), mock.log.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const nonGet = mock.log.filter((r) => r.method !== "GET");
  check(`подложная 1С: ${mock.log.length} запросов, все GET`, mock.log.length > 0 && nonGet.length === 0, JSON.stringify(nonGet.slice(0, 3)));
  check("подложная 1С: все запросы с паролем и внутри публикации OData", mock.log.every((r) => r.auth && r.path.startsWith(BASE)), JSON.stringify(mock.log.filter((r) => !r.auth || !r.path.startsWith(BASE)).slice(0, 3)));
  check("подложная 1С: $expand=Контрагент подставлен из select", mock.log.some((r) => (r.query.$expand || "").includes("Контрагент")), "нет запроса с $expand");
  check("подложная 1С: попытка ../ до 1С не дошла", !mock.log.some((r) => r.path.includes("$batch") || r.path.includes("..")), "был запрос с ../");
  const methods = [...SERVER_SRC.toString("utf8").matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]);
  check("код сервера: HTTP-метод только GET", methods.length > 0 && methods.every((m) => m === "GET"), methods.join(","));

  await rawStdio(env, serverJs);
  await mock.close();
  fs.rmSync(home, { recursive: true, force: true });
}

// Сырой stdio так, как его читает Codex: в stdout только строки JSON-RPC, сервер выходит, когда клиент закрыл stdin.
async function rawStdio(env, serverJs) {
  const p = spawn(process.execPath, [serverJs], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "codex-like", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_connection", arguments: {} } });
  const t0 = Date.now();
  while (!/"id":3[,}]/.test(out) && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 50));
  const lines = out.split("\n").filter((l) => l.trim());
  const bad = lines.filter((l) => { try { return JSON.parse(l).jsonrpc !== "2.0"; } catch { return true; } });
  check("stdio: в stdout только JSON-RPC (логи в stderr, протокол не ломается)", lines.length >= 3 && bad.length === 0, bad.slice(0, 2).join(" | ") || `строк ${lines.length}`);
  let init = {}; try { init = JSON.parse(lines[0]).result || {}; } catch {}
  check(`stdio: protocolVersion согласован (${LATEST_PROTOCOL_VERSION})`, init.protocolVersion === LATEST_PROTOCOL_VERSION, JSON.stringify(init).slice(0, 200));
  const exited = new Promise((r) => p.on("exit", (code) => r(code)));
  p.stdin.end();
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r("висит"), 5000))]);
  if (code === "висит") p.kill();
  check("stdio: сервер выходит сам, когда клиент закрыл stdin (не остаётся висеть)", code !== "висит", `код ${code}`);
}

// ---------- фаза pack ----------
function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts, stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
    if (opts.input !== undefined) { p.stdin.end(opts.input); }
    const t = setTimeout(() => { p.kill(); out += "\n[убит по таймауту 120 с]"; }, 120_000);
    p.on("error", (e) => { clearTimeout(t); res({ code: -1, out: out + e.message }); });
    p.on("exit", (code) => { clearTimeout(t); res({ code, out }); });
  });
}
const PY_UNZIP = "import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps([[i.filename,i.external_attr>>16] for i in z.infolist()]))\nz.extractall(sys.argv[2])";
async function unzip(zip, dest) {
  const r = await run(process.env.VERIFY_PYTHON || "python", ["-I", "-c", PY_UNZIP, zip, dest]);
  if (r.code !== 0) throw new Error("распаковка " + zip + ": " + r.out.slice(0, 300));
  return new Map(JSON.parse(r.out.trim().split("\n").pop()));
}
const FORBIDDEN = /(^|\/)(settings\.xml|config\.toml|\.env(\..*)?|[^/]*\.bak-1c|hostkey[^/]*|tests?|__tests__|cpu-features|nan)(\/|$)/;

// dev-зависимости (тесты, fast-check и подобные) по package-lock: в пакет для пользователей они попадать не должны
const DEV_PKGS = Object.entries(JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8")).packages || {}).filter(([k, v]) => k && v.dev).map(([k]) => k + "/");
async function phasePack() {
  const DIST = arg("dist"), WORK = arg("work");
  const winZip = path.join(DIST, "1c-connector-for-chatgpt.zip"), macZip = path.join(DIST, "1c-connector-for-chatgpt-mac.zip");
  check("сборка: оба архива на месте (Windows и Mac)", fs.existsSync(winZip) && fs.existsSync(macZip), fs.existsSync(DIST) ? fs.readdirSync(DIST).join(",") : "нет dist");
  if (!fs.existsSync(winZip) || !fs.existsSync(macZip)) return;
  for (const z of [winZip, macZip]) { const mb = fs.statSync(z).size / 1e6; check(`сборка: ${path.basename(z)} ${mb.toFixed(1)} МБ (от 1 до 15)`, mb > 1 && mb < 15, mb); }

  // --- Windows: состав ---
  const W = path.join(WORK, "win");
  const wl = await unzip(winZip, W);
  const R = "1c-connector-for-chatgpt/";
  const need = ["INSTALL.bat", "README.txt", "installer/install.ps1", "installer/UNINSTALL.bat", "app/launcher.js", "app/settings.js", "app/selftest.js", "app/server/index.js", "app/package.json", "app/node_modules/@modelcontextprotocol/sdk/package.json", "app/node_modules/ssh2/package.json", "app/node_modules/zod/package.json"];
  const missing = need.filter((f) => !wl.has(R + f));
  check("Windows ZIP: все файлы программы и зависимости на месте", missing.length === 0, missing.join(", "));
  const forb = [...wl.keys()].filter((f) => FORBIDDEN.test(f));
  check("Windows ZIP: нет настроек, паролей, тестов и нативных модулей", forb.length === 0, forb.slice(0, 5).join(", "));
  const wdev = [...wl.keys()].filter((f) => DEV_PKGS.some((d) => f.startsWith(R + "app/" + d)));
  check(`Windows ZIP: без dev-зависимостей (${DEV_PKGS.length} по package-lock)`, DEV_PKGS.length > 0 && wdev.length === 0, wdev.slice(0, 5).join(", ") || "в package-lock нет dev-пакетов, проверка ничего не проверяет");
  check("Windows ZIP: server/index.js совпадает с репо байт в байт", fs.readFileSync(path.join(W, R, "app/server/index.js")).equals(SERVER_SRC), "отличается");
  const ps1 = fs.readFileSync(path.join(W, R, "installer/install.ps1"));
  const crlfOnly = (b) => !/(^|[^\r])\n/.test(b.toString("latin1"));
  check("Windows ZIP: install.ps1 с BOM и переводами строк CRLF (PowerShell 5.1 читает кириллицу)", ps1.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && crlfOnly(ps1), "нет BOM или есть LF");
  check("Windows ZIP: INSTALL.bat и UNINSTALL.bat с CRLF", crlfOnly(fs.readFileSync(path.join(W, R, "INSTALL.bat"))) && crlfOnly(fs.readFileSync(path.join(W, R, "installer/UNINSTALL.bat"))), "есть LF");

  // --- Windows: установка как у пользователя, но в папки прогона ---
  if (process.platform === "win32") {
    const mock = await startMock();
    const home = path.join(WORK, "home");
    fs.mkdirSync(home, { recursive: true });
    const env = baseEnv(home);
    const inst = path.join(WORK, "inst", "1c-connector"), sets = path.join(WORK, "settings"), toml = path.join(home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(toml), { recursive: true });
    fs.writeFileSync(toml, 'model = "verify"\n\n[mcp_servers.other]\ncommand = "other"\n');
    const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const psArgs = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(W, R, "installer", "install.ps1"), "-InstallDir", inst, "-SettingsDir", sets, "-ConfigToml", toml];
    const r = await run(ps, [...psArgs, "-ODataUrl", mock.url, "-ODataUser", USER, "-ODataPasswordPlain", PASS, "-Description", "Смоук-база verify"], { env });
    fs.writeFileSync(path.join(OUT, "install-windows.log"), r.out);
    check("установка Windows: install.ps1 прошёл, самопроверка «Связь с 1С работает»", r.code === 0 && r.out.includes("Связь с 1С работает") && r.out.includes("логин и пароль приняты"), r.out.slice(-500));
    const cfg = fs.existsSync(toml) ? fs.readFileSync(toml, "utf8") : "";
    fs.writeFileSync(path.join(OUT, "config-windows.toml"), cfg);
    const blocks = (cfg.match(/^\[mcp_servers\.one-c-odata\]/gm) || []).length;
    check("установка Windows: config.toml, один блок one-c-odata, чужие настройки целы", blocks === 1 && cfg.includes('model = "verify"') && cfg.includes("[mcp_servers.other]") && cfg.includes('default_tools_approval_mode = "writes"'), cfg);
    const xml = fs.existsSync(path.join(sets, "settings.xml")) ? fs.readFileSync(path.join(sets, "settings.xml"), "utf8") : "";
    check("установка Windows: пароль 1С не лежит открытым текстом ни в config.toml, ни в settings.xml", xml.length > 0 && !xml.includes(PASS) && !cfg.includes(PASS), xml ? "пароль найден" : "нет settings.xml");

    // Запуск так, как это делает Codex: command + args + env из config.toml.
    const ours = cfg.slice(cfg.indexOf("[mcp_servers.one-c-odata]")); // только наш блок: выше лежат чужие [mcp_servers.*]
    const cmd = (ours.match(/^command = (.+)$/m) || [])[1], a0 = (ours.match(/^args = \[(.+)\]$/m) || [])[1], onec = (ours.match(/^ONEC_SETTINGS = (.+)$/m) || [])[1];
    const unq = (s) => (s || "").trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, (_, x) => x.replace(/\\\\/g, "\\").replace(/\\"/g, '"'));
    try {
      await withMcp(unq(cmd), [unq(a0)], { ...env, ONEC_SETTINGS: unq(onec) }, async (c) => {
        const { tools } = await c.listTools();
        const x = await call(c, "check_connection");
        check("Codex-запуск из config.toml: launcher расшифровал пароль, 7 инструментов, связь есть", tools.length === EXPECTED_TOOLS.length && x.text.includes("логин и пароль приняты"), x.text.slice(0, 300));
      });
    } catch (e) { check("Codex-запуск из config.toml: launcher расшифровал пароль, 7 инструментов, связь есть", false, e.message); }

    const u = await run(ps, [...psArgs, "-Uninstall", "-Yes"], { env });
    fs.writeFileSync(path.join(OUT, "uninstall-windows.log"), u.out);
    const after = fs.existsSync(toml) ? fs.readFileSync(toml, "utf8") : "";
    check("удаление Windows: блок убран, чужие настройки целы, файлы и пароли удалены", u.code === 0 && !after.includes("one-c-odata") && after.includes("[mcp_servers.other]") && !fs.existsSync(inst) && !fs.existsSync(path.join(sets, "settings.xml")), u.out.slice(-300));
    await mock.close();
  } else {
    check("установка Windows: пропущена, не Windows", true);
  }

  // --- Mac: состав и установка через install-mac.sh (в Git Bash) ---
  const M = path.join(WORK, "mac");
  const ml = await unzip(macZip, M);
  const MR = "1c-connector/";
  const mneed = ["install-mac.sh", "check.mjs", "server/index.js", "package.json", "node_modules/@modelcontextprotocol/sdk/package.json"];
  const mmiss = mneed.filter((f) => !ml.has(MR + f));
  check("Mac ZIP: все файлы на месте", mmiss.length === 0, mmiss.join(", "));
  check("Mac ZIP: install-mac.sh исполняемый (0755)", ((ml.get(MR + "install-mac.sh") || 0) & 0o777) === 0o755, (ml.get(MR + "install-mac.sh") || 0).toString(8));
  check("Mac ZIP: install-mac.sh и check.mjs без CR", !fs.readFileSync(path.join(M, MR, "install-mac.sh")).includes(13) && !fs.readFileSync(path.join(M, MR, "check.mjs")).includes(13), "есть CR");
  const mforb = [...ml.keys()].filter((f) => FORBIDDEN.test(f) || f.endsWith("pagent.exe"));
  check("Mac ZIP: нет настроек, тестов, pagent.exe", mforb.length === 0, mforb.slice(0, 5).join(", "));
  const mdev = [...ml.keys()].filter((f) => DEV_PKGS.some((d) => f.startsWith(MR + d)));
  check(`Mac ZIP: без dev-зависимостей (${DEV_PKGS.length} по package-lock)`, DEV_PKGS.length > 0 && mdev.length === 0, mdev.slice(0, 5).join(", ") || "в package-lock нет dev-пакетов, проверка ничего не проверяет");
  check("Mac ZIP: server/index.js совпадает с репо", fs.readFileSync(path.join(M, MR, "server/index.js")).equals(SERVER_SRC), "отличается");

  const bash = process.env.VERIFY_BASH;
  if (bash) {
    const mock = await startMock();
    const mhome = path.join(WORK, "machome");
    fs.mkdirSync(mhome, { recursive: true });
    // ONEC_DEST = папка распаковки, как её видит сам bash (pwd): тогда install-mac.sh не копирует 40 МБ node_modules.
    // Путь из Node не годится: Git Bash показывает Temp как /tmp, и сравнение SRC и DEST не сходится.
    const fwd = (p) => p.split(path.sep).join("/");
    const env = { ...baseEnv(mhome), CODEX_HOME: fwd(path.join(mhome, ".codex")), ONEC_NODE: fwd(process.execPath) };
    const answers = `${mock.url}\n${USER}\n${PASS}\nнет\n`;
    const viaBash = ["-c", 'cd "$1" && ONEC_DEST="$(pwd)" exec bash ./install-mac.sh', "_", fwd(path.join(M, "1c-connector"))];
    const r1 = await run(bash, viaBash, { env, input: answers });
    const r2 = await run(bash, viaBash, { env, input: answers });
    fs.writeFileSync(path.join(OUT, "install-mac.log"), r1.out + "\n----- повтор -----\n" + r2.out);
    check("установка Mac: install-mac.sh записал config.toml, check.mjs видит 1С", r1.code === 0 && r1.out.includes("логин и пароль приняты"), r1.out.slice(-400));
    const mcfg = fs.readFileSync(path.join(mhome, ".codex", "config.toml"), "utf8");
    fs.writeFileSync(path.join(OUT, "config-mac.toml"), mcfg.replace(PASS, "<пароль стенда>"));
    check("установка Mac: повторный запуск не плодит второй блок one-c-odata", r2.code === 0 && (mcfg.match(/^\[mcp_servers\.one-c-odata\]/gm) || []).length === 1 && r2.out.includes("логин и пароль приняты"), mcfg);
    await mock.close();
  } else {
    check("установка Mac: пропущена, нет VERIFY_BASH", true);
  }
}

const t0 = Date.now();
try { await (phase === "mcp" ? phaseMcp() : phasePack()); }
catch (e) { check(`фаза ${phase} дошла до конца`, false, e.stack || e.message); }
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, `result-${phase}.json`), JSON.stringify({ phase, ms: Date.now() - t0, pass: results.length - failed.length, fail: failed.length, results }, null, 2));
console.log(`SMOKE ${phase}: ${results.length - failed.length}/${results.length} за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
process.exit(failed.length ? 1 : 0);
