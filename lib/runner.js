"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { commitMessage } = require("./ai");

const MAX_DIFF_CHARS = 20000;
const LOCKFILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

const errText = (e) =>
  ((e.stderr?.toString() || "") + (e.stdout?.toString() || "")).trim() || e.message;

// Files we never auto-commit, even if they are not in .gitignore
function isSensitive(file) {
  const name = path.basename(file);
  if (name === ".env" || (name.startsWith(".env.") && !/\.(example|sample|template)$/.test(name))) return true;
  return /\.(pem|key|p12|pfx)$/i.test(name) || /^id_(rsa|ed25519|dsa|ecdsa)/.test(name);
}

function createRunner(opts, log) {
  const repo = opts.repo;
  const git = (...args) =>
    execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd: repo,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
  const lines = (s) => s.split("\n").filter(Boolean);

  let running = false;
  let pending = false;

  function inProgress() {
    return ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"].some((n) =>
      fs.existsSync(path.resolve(repo, git("rev-parse", "--git-path", n)))
    );
  }

  function ensureBranch() {
    if (!opts.branch) return;
    if (git("symbolic-ref", "--short", "HEAD") === opts.branch) return;
    try {
      git("switch", opts.branch);
    } catch {
      git("switch", "-c", opts.branch);
    }
    log(`Now on branch '${opts.branch}' (your other branches are untouched).`);
  }

  function unstageSensitive() {
    for (const f of lines(git("diff", "--cached", "--name-only")).filter(isSensitive)) {
      try {
        git("reset", "-q", "HEAD", "--", f);
      } catch {
        git("rm", "--cached", "-q", "--", f);
      }
      log(`⚠️  Skipped sensitive file: ${f} (add it to .gitignore)`);
    }
  }

  function push() {
    try {
      git("push");
    } catch (e) {
      if (/no upstream|--set-upstream/i.test(errText(e))) git("push", "-u", "origin", "HEAD");
      else throw e;
    }
  }

  async function runOnce() {
    if (inProgress()) {
      log("A merge/rebase is in progress, skipping this round.");
      return true;
    }
    if (!git("status", "--porcelain")) {
      log("No changes.");
      return true;
    }

    git("add", "-A");
    unstageSensitive();

    const rows = lines(git("diff", "--cached", "--name-status")).map((l) => l.split("\t"));
    const files = rows.map((r) => r[r.length - 1]);
    if (!files.length) {
      log("Nothing safe to commit.");
      return true;
    }

    if (opts.check) {
      log(`Running check: ${opts.check}`);
      const r = spawnSync(opts.check, { cwd: repo, shell: true, stdio: "inherit" });
      if (r.status !== 0) {
        git("reset", "-q");
        log("❌ Check failed, nothing committed. Fix the problem and save again.");
        return false;
      }
    }

    let diff = "";
    if (!opts.filesOnly) {
      diff = git("diff", "--cached", "--", ".", ...LOCKFILES.map((f) => `:(exclude)${f}`));
      if (diff.length > MAX_DIFF_CHARS) diff = diff.slice(0, MAX_DIFF_CHARS) + "\n...[truncated]";
    }

    const message = await commitMessage({ provider: opts.provider, model: opts.model, files, rows, diff, log });
    log(`Committing ${files.length} file(s): ${message}`);

    if (opts.dryRun) {
      git("reset", "-q");
      log("Dry run: nothing was committed or pushed.");
      return true;
    }

    git("commit", "-m", message);

    try {
      push();
    } catch (e) {
      if (!/rejected|fetch first|non-fast-forward/i.test(errText(e))) throw e;
      log("Remote has new commits, running git pull --rebase...");
      try {
        git("pull", "--rebase", "--autostash");
      } catch {
        try {
          git("rebase", "--abort");
        } catch {}
        throw new Error("Rebase conflict. Resolve it manually (git pull), then save again.");
      }
      push();
    }
    log("✅ Pushed.");
    return true;
  }

  async function run() {
    if (running) {
      pending = true;
      return true;
    }
    running = true;
    let ok = true;
    try {
      ok = await runOnce();
    } catch (e) {
      ok = false;
      log("❌ Error:", errText(e));
    } finally {
      running = false;
      if (pending) {
        pending = false;
        run();
      }
    }
    return ok;
  }

  return { run, ensureBranch, git };
}

module.exports = { createRunner, isSensitive };
