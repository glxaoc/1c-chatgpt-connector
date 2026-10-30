import ssh2 from "ssh2"; import net from "node:net"; import fs from "node:fs";
const { Server, utils } = ssh2;
const keyFile = process.env.KEYFILE;
let key; if (keyFile && fs.existsSync(keyFile)) key = fs.readFileSync(keyFile,"utf8"); else { key = utils.generateKeyPairSync("ed25519").private; if (keyFile) fs.writeFileSync(keyFile,key); }
new Server({ hostKeys: [key] }, (client) => {
  client.on("authentication", (ctx) => {
    if (ctx.method === "password" && ctx.username === "deploy" && ctx.password === "srv pass") return ctx.accept();
    ctx.reject(process.env.MODE === "keyonly" ? ["publickey"] : ["password"]);
  }).on("ready", () => {
    client.on("tcpip", (accept, reject, info) => {
      const sock = net.connect(info.destPort, info.destIP, () => { const ch = accept(); sock.pipe(ch).pipe(sock); });
      sock.on("error", () => reject());
    });
  }).on("error", () => {});
}).listen(Number(process.env.PORT||2224), "127.0.0.1", () => console.error("ssh2 up"));
