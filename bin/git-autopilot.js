#!/usr/bin/env node
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const pkg = require("../package.json");
const { loadConfigFiles } = require("../lib/config");
const { PROVIDERS, DEFAULT_MODELS } = require("../lib/ai");
const { createRunner } = require("../lib/runner");

const HELP = `git-autopilot ${pkg.version}
Watches a git project and automatically: git add -> AI commit message -> git commit -> git push

Usage:
  git-autopilot [path] [options]       (path defaults to the current folder)

Options:
  --once              Commit and push once, then exit
  --dry-run           Show the commit message, but do not commit or push
  --delay <seconds>   Wait this long after your last save (default: 30)
  --branch <name>     Work on this branch (created if missing), e.g. auto-save
  --check "<cmd>"     Run a command first (e.g. "npm run build"); no push if it fails
  --provider <name>   gemini | ollama | openrouter | none   (default: auto-detect)
  --model <name>      Override the AI model
  --files-only        Send only file names to the AI, never your code
  -h, --help          Show this help
  -v, --version       Show version

Config (env vars, <project>/.env or ~/.git-autopilot.env):
  GEMINI_API_KEY, OPENROUTER_API_KEY, OLLAMA_URL, AUTOPILOT_PROVIDER, AUTOPILOT_MODEL
`;

const log = (...m) => console.log(`[${new Date().toLocaleTimeString()}]`, ...m);
const fail = (msg) => {
  console.error(`Error: ${msg}`);
  process.exit(1);
};

function parseArgs(argv) {
  const o = { path: null, once: false, dryRun: false, delay: 30, branch: null, check: null, provider: null, model: null, filesOnly: false };
  const val = (i, name) => {
    if (i + 1 >= argv.length) fail(`${name} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        console.log(HELP);
        process.exit(0);
      case "-v":
      case "--version":
        console.log(pkg.version);
        process.exit(0);
      case "--once": o.once = true; break;
      case "--dry-run": o.dryRun = true; break;
      case "--files-only": o.filesOnly = true; break;
      case "--delay": o.delay = Number(val(i, a)); i++; break;
      case "--branch": o.branch = val(i, a); i++; break;
      case "--check": o.check = val(i, a); i++; break;
      case "--provider": o.provider = val(i, a).toLowerCase(); i++; break;
      case "--model": o.model = val(i, a); i++; break;
      default:
        if (a.startsWith("-")) fail(`Unknown option: ${a} (see --help)`);
        if (o.path) fail("Only one project path is allowed");
        o.path = a;
    }
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const repo = path.resolve(o.path || process.cwd());

  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repo, stdio: "ignore" });
  } catch {
    fail(`${repo} is not a git repository (or the path does not exist). Run 'git init' and add a remote first.`);
  }

  loadConfigFiles(repo);

  const provider =
    o.provider ||
    process.env.AUTOPILOT_PROVIDER?.toLowerCase() ||
    (process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENROUTER_API_KEY ? "openrouter" : "none");
  if (!PROVIDERS.includes(provider)) fail(`Unknown provider '${provider}'. Use: ${PROVIDERS.join(", ")}`);
  if (provider === "gemini" && !process.env.GEMINI_API_KEY)
    fail("GEMINI_API_KEY is missing. Get a free key at https://aistudio.google.com/apikey");
  if (provider === "openrouter" && !process.env.OPENROUTER_API_KEY) fail("OPENROUTER_API_KEY is missing.");
  if (!Number.isFinite(o.delay) || o.delay < 1) fail("--delay must be a number of seconds (1 or more)");

  const model = o.model || process.env.AUTOPILOT_MODEL || DEFAULT_MODELS[provider];

  if (!o.dryRun && !execFileSync("git", ["remote"], { cwd: repo }).toString().trim())
    fail("This repository has no remote. Add one first: git remote add origin <your-github-url>");

  const runner = createRunner({ repo, provider, model, dryRun: o.dryRun, branch: o.branch, check: o.check, filesOnly: o.filesOnly }, log);

  try {
    runner.ensureBranch();
  } catch (e) {
    fail(`Could not switch to branch '${o.branch}': ${(e.stderr || e.message).toString().trim()}`);
  }

  if (o.once) {
    const ok = await runner.run();
    process.exit(ok ? 0 : 1);
  }

  log(`🤖 AI: ${provider}${model ? ` (${model})` : ""}${o.filesOnly ? " [files only]" : ""}${o.dryRun ? " [DRY RUN]" : ""}`);
  log(`👀 Watching ${repo}`);
  log(`   Commits ${o.delay}s after your last save${o.check ? `, check: ${o.check}` : ""}. Press Ctrl+C to stop.`);

  const chokidar = require("chokidar");
  let timer;
  chokidar
    .watch(repo, {
      ignored: [/(^|[\/\\])\.git([\/\\]|$)/, /node_modules/, /(^|[\/\\])(dist|build|\.next|coverage)([\/\\]|$)/],
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    })
    .on("all", () => {
      clearTimeout(timer);
      timer = setTimeout(() => runner.run(), o.delay * 1000);
    });

  process.on("SIGINT", () => {
    log("Stopped. Bye!");
    process.exit(0);
  });
}

main().catch((e) => fail(e.message));
