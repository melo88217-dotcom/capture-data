const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const env = loadEnv(path.join(root, ".env.development"));

const frontendPort = numberEnv("FRONTEND_PORT");
const backendPort = numberEnv("BACKEND_PORT");
const frontendHost = env.FRONTEND_HOST || "0.0.0.0";
const backendHost = env.BACKEND_HOST || "0.0.0.0";

let apiProcess;
let webProcess;
let shuttingDown = false;

main().catch((error) => {
  console.error(`[dev:safe] ${error.message}`);
  process.exit(1);
});

async function main() {
  requireFile(path.join(root, "src", "backend", "server.js"), "Missing src/backend/server.js.");
  requireFile(path.join(root, "vite.config.js"), "Missing vite.config.js.");

  await assertPortFree(frontendPort, "frontend");
  await assertPortFree(backendPort, "backend");

  console.log(`[dev:safe] Project: ${root}`);
  console.log(`[dev:safe] Frontend: http://localhost:${frontendPort}`);
  console.log(`[dev:safe] Backend:  http://localhost:${backendPort}`);

  apiProcess = spawnCommand(
    process.execPath,
    [path.join(root, "src", "backend", "server.js")],
    root,
    {
      ...process.env,
      ...env,
      API_HOST: backendHost,
      API_PORT: String(backendPort)
    },
    false
  );

  webProcess = spawnCommand(
    process.execPath,
    [
      path.join(root, "node_modules", "vite", "bin", "vite.js"),
      "--host",
      frontendHost,
      "--port",
      String(frontendPort),
      "--strictPort"
    ],
    root,
    {
      ...process.env,
      ...env,
      VITE_API_BASE_URL: env.VITE_API_BASE_URL || `http://127.0.0.1:${backendPort}`
    },
    false
  );

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) {
    throw new Error("Missing .env.development. Allocate ports in Local Project Launcher first.");
  }

  const result = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}

function numberEnv(key) {
  const value = Number(env[key]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${key} in .env.development.`);
  }
  return value;
}

function requireFile(file, message) {
  if (!fs.existsSync(file)) {
    throw new Error(message);
  }
}

function assertPortFree(port, label) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => {
      reject(new Error(`${label} port ${port} is already in use. Fix the conflict in Local Project Launcher.`));
    });
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

function spawnCommand(command, args, cwd, childEnv, shell = process.platform === "win32") {
  const child = spawn(command, args, {
    cwd,
    env: childEnv,
    stdio: "inherit",
    shell
  });

  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`[dev:safe] ${command} exited with code ${code}.`);
    }
  });

  return child;
}

function shutdown() {
  shuttingDown = true;
  if (webProcess && !webProcess.killed) webProcess.kill();
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
}
