// One command to bring up the whole Person 2 workstream:
//   node scripts/start-all.mjs [--down=PROVIDER-B] [--mode=PROVIDER-A:fail_activation]
//
// Starts the three provider agents (8101–8103) and the Rescue Agent gateway
// (GATEWAY_PORT, default 8082). Failure-mode flags are forwarded to the
// provider agents for the "kill a provider live" demo beat.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwardArgs = process.argv.slice(2);

const children = [];

function run(name, script, args) {
  const child = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", path.join(projectRoot, script), ...args],
    { stdio: ["ignore", "inherit", "inherit"] }
  );

  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    child.kill("SIGINT");
  }

  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("provider-agents", "scripts/start-provider-agents.mjs", forwardArgs);
run("rescue-agent", "scripts/start-rescue-agent.mjs", []);

console.log("NetChain agent market running. Ctrl+C to stop everything.");
