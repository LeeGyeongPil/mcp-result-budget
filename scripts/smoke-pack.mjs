// Packs the library, installs the tarball into empty temp projects next to SDK v1 and v2,
// and runs examples/minimal.mjs in each. Needs network access to the npm registry.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const work = mkdtempSync(join(tmpdir(), "mcp-result-budget-smoke-"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  run("npm", ["pack", "--pack-destination", packDir], root);
  const tarball = join(packDir, readdirSync(packDir).find((f) => f.endsWith(".tgz")));

  const variants = [
    { label: "sdk@1.32.2", flavor: "v1", deps: ["@modelcontextprotocol/sdk@1.32.2", "zod@4.6.7"] },
    { label: "server@2.4.0", flavor: "v2", deps: ["@modelcontextprotocol/server@2.4.0", "@modelcontextprotocol/client@2.4.0", "zod@4.6.7"] },
  ];
  for (const v of variants) {
    const dir = join(work, v.flavor);
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
    run("npm", ["install", "--no-audit", "--no-fund", tarball, ...v.deps], dir);
    copyFileSync(join(root, "examples", "minimal.mjs"), join(dir, "minimal.mjs"));
    const out = run("node", ["minimal.mjs", v.flavor], dir).trim();
    console.log(`${out}\nsmoke ok ${v.label}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
