"use strict";
const assert = require("assert");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI = path.join(__dirname, "..", "bin", "git-autopilot.js");
const g = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const write = (dir, f, c) => fs.writeFileSync(path.join(dir, f), c);

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ga-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  fs.mkdirSync(work);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  g(work, "init", "-q", "-b", "main");
  g(work, "remote", "add", "origin", remote);
  g(work, "config", "user.email", "t@t.t");
  g(work, "config", "user.name", "tester");
  return { root, remote, work };
}
const run = (work, ...args) =>
  spawnSync("node", [CLI, work, "--once", "--provider", "none", ...args], {
    encoding: "utf8",
    env: { ...process.env, GEMINI_API_KEY: "", OPENROUTER_API_KEY: "" },
  });
const remoteLog = (remote) => g(remote, "log", "--oneline", "main").split("\n").filter(Boolean);
const remoteFiles = (remote) => g(remote, "ls-tree", "--name-only", "main").split("\n");

let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

// 1) commits, pushes, skips secrets
{
  const { remote, work } = setup();
  write(work, "a.js", "hello");
  write(work, ".env", "SECRET=1");
  const r = run(work);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(remoteFiles(remote), ["a.js"]);
  assert.strictEqual(remoteLog(remote).length, 1);
  ok("commits + pushes and skips .env");

  // 2) remote moved ahead -> auto pull --rebase, then push
  const other = path.join(path.dirname(work), "other");
  execFileSync("git", ["clone", "-q", remote, other]);
  g(other, "config", "user.email", "o@o.o");
  g(other, "config", "user.name", "other");
  write(other, "c.js", "from other");
  g(other, "add", "-A");
  g(other, "commit", "-q", "-m", "other commit");
  g(other, "push", "-q");
  write(work, "d.js", "mine");
  const r2 = run(work);
  assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
  assert.deepStrictEqual(remoteFiles(remote).sort(), ["a.js", "c.js", "d.js"]);
  ok("auto pull --rebase when remote has new commits");
}

// 3) dry run changes nothing
{
  const { remote, work } = setup();
  write(work, "x.js", "x");
  const r = run(work, "--dry-run");
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.throws(() => g(work, "rev-parse", "--verify", "HEAD"));
  assert.ok(g(work, "status", "--porcelain").includes("x.js"));
  assert.throws(() => g(remote, "log", "--oneline", "main"));
  ok("--dry-run does not commit or push");
}

// 4) failing check blocks the commit
{
  const { remote, work } = setup();
  write(work, "x.js", "x");
  const r = run(work, "--check", 'node -e "process.exit(1)"');
  assert.strictEqual(r.status, 1);
  assert.throws(() => g(work, "rev-parse", "--verify", "HEAD"));
  assert.throws(() => g(remote, "log", "--oneline", "main"));
  ok("failing --check blocks commit and push");
}

// 5) passing check + --branch
{
  const { remote, work } = setup();
  write(work, "x.js", "x");
  const r = run(work, "--check", 'node -e "process.exit(0)"', "--branch", "auto-save");
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(g(remote, "branch", "--list", "auto-save"));
  assert.throws(() => g(remote, "log", "--oneline", "main"));
  ok("--branch pushes to a separate branch, main untouched");
}

// 6) CLI basics
{
  const h = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
  assert.strictEqual(h.status, 0);
  assert.ok(h.stdout.includes("--dry-run"));
  const bad = spawnSync("node", [CLI, os.tmpdir(), "--once"], { encoding: "utf8" });
  assert.strictEqual(bad.status, 1);
  ok("--help works and non-git folders are rejected");
}
console.log("\nAll tests passed.");
