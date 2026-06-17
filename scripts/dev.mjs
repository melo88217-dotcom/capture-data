import { spawn } from "node:child_process";

const commands = [
  ["api", process.execPath, ["src/backend/server.js"]],
  process.platform === "win32"
    ? ["web", "cmd.exe", ["/d", "/s", "/c", "npm run dev:web"]]
    : ["web", "npm", ["run", "dev:web"]]
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env }
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      process.exitCode = code;
    }
  });

  return child;
});

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
