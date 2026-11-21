"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

// Only these keys are ever read from .env files, so we never touch unrelated secrets of your project.
const ALLOWED = new Set([
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "OLLAMA_URL",
  "AUTOPILOT_PROVIDER",
  "AUTOPILOT_MODEL",
]);

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// Priority: real environment variables > <project>/.env > ~/.git-autopilot.env
function loadConfigFiles(repo) {
  for (const file of [path.join(repo, ".env"), path.join(os.homedir(), ".git-autopilot.env")]) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parseEnv(text))) {
      if (ALLOWED.has(k) && v && process.env[k] === undefined) process.env[k] = v;
    }
  }
}

module.exports = { loadConfigFiles, parseEnv };
