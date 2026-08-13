import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 5173;

function localIpv4Addresses() {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.add(entry.address);
    }
  }
  return [...addresses].sort();
}

console.log("");
console.log("D.Y.O.O.R: Echoes of the Core");
console.log(`Local browser:  http://localhost:${port}`);
for (const address of localIpv4Addresses()) {
  console.log(`Mobile / LAN:    http://${address}:${port}`);
}
console.log("Mock mode:       built in; no mock API process is required");
console.log("Wallet mode:     requires the approved D.Y.O.O.R host bridge");
console.log("");

const child = spawn(
  process.execPath,
  [path.join(packageRoot, "node_modules", "vite", "bin", "vite.js"), "--host", "0.0.0.0", "--port", String(port), "--strictPort"],
  {
    cwd: packageRoot,
    env: process.env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
