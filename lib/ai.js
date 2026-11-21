"use strict";
const path = require("path");

const PROVIDERS = ["gemini", "openrouter", "ollama", "none"];
const DEFAULT_MODELS = {
  gemini: "gemini-3.8-flash",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  ollama: "llama3.2",
};

const SYSTEM_PROMPT =
  "Write ONE git commit message in Conventional Commits format (feat:, fix:, refactor:, docs:, style:, test:, chore:). " +
  "Max 72 characters, imperative mood, no quotes, no markdown, no trailing period. Output only the message.";

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText;
    throw new Error(`${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

async function callProvider(provider, model, userText) {
  if (provider === "gemini") {
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { "x-goog-api-key": process.env.GEMINI_API_KEY },
      {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
      }
    );
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  }
  if (provider === "openrouter") {
    const data = await postJson(
      "https://openrouter.ai/api/v1/chat/completions",
      { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
      }
    );
    return data.choices?.[0]?.message?.content;
  }
  if (provider === "ollama") {
    const base = process.env.OLLAMA_URL || "http://localhost:11434";
    const data = await postJson(`${base}/api/chat`, {}, {
      model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
    });
    return data.message?.content;
  }
  return null;
}

function clean(raw) {
  if (!raw) return null;
  const line = raw
    .replace(/```[a-z]*/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  return line.replace(/^["'`]+|["'`]+$/g, "").replace(/\.$/, "").slice(0, 72) || null;
}

// No-AI message built from `git diff --name-status` rows: [["M","src/a.js"], ["A","b.js"], ["R100","old","new"]]
function fallbackMessage(rows) {
  const verb = { A: "add", M: "update", D: "remove", R: "rename" };
  const parts = rows.slice(0, 3).map((r) => `${verb[r[0][0]] || "update"} ${path.basename(r[r.length - 1])}`);
  const more = rows.length > 3 ? ` and ${rows.length - 3} more` : "";
  return `chore: ${parts.join(", ")}${more}`.slice(0, 72);
}

async function commitMessage({ provider, model, files, rows, diff, log }) {
  if (provider === "none") return fallbackMessage(rows);
  try {
    const text = `Changed files:\n${files.join("\n")}` + (diff ? `\n\nDiff:\n${diff}` : "");
    return clean(await callProvider(provider, model, text)) || fallbackMessage(rows);
  } catch (e) {
    log(`AI request failed (${e.message}). Using a file-based message instead.`);
    return fallbackMessage(rows);
  }
}

module.exports = { PROVIDERS, DEFAULT_MODELS, commitMessage, fallbackMessage };
