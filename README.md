# git-autopilot

> A local AI agent that watches your project and automatically runs `git add` → writes a commit message with AI → `git commit` → `git push`. Free to use with Gemini or Ollama.

You code. When you stop saving for 30 seconds, git-autopilot commits and pushes for you, with a proper
[Conventional Commit](https://www.conventionalcommits.org/) message like `feat(navbar): add search bar`.

<!-- Add a short demo GIF here: ![demo](demo.gif) -->

## Quick start

```bash
# 1. Get a free Gemini key: https://aistudio.google.com/apikey
# 2. Save it once for all your projects:
echo "GEMINI_API_KEY=your_key_here" > ~/.git-autopilot.env      # macOS/Linux
#    Windows (PowerShell): "GEMINI_API_KEY=your_key_here" | Out-File -Encoding ascii $HOME\.git-autopilot.env

# 3. Try it without changing anything (shows the commit message only):
npx git-autopilot-ai /path/to/your/project --once --dry-run

# 4. Run it for real (keeps watching until Ctrl+C):
npx git-autopilot-ai /path/to/your/project
```

Your project must already be a git repository with a remote (`git remote -v`) and `git push` must work manually once.

## Options

| Option | What it does |
| --- | --- |
| `--once` | Commit and push once, then exit |
| `--dry-run` | Print the commit message, but do not commit or push |
| `--delay <seconds>` | Wait after your last save before committing (default 30) |
| `--branch <name>` | Work on a separate branch (e.g. `auto-save`) so `main` stays clean |
| `--check "<cmd>"` | Run a command first, e.g. `"npm run build"`. If it fails, nothing is pushed |
| `--provider <name>` | `gemini`, `ollama`, `openrouter` or `none` (default: auto-detect) |
| `--model <name>` | Use a different AI model |
| `--files-only` | Send only file names to the AI, never your code |

## AI providers (all have a free option)

| Provider | Cost | Notes |
| --- | --- | --- |
| **Gemini** | Free tier | Set `GEMINI_API_KEY`. Default model: `gemini-3.8-flash` (change with `--model`) |
| **Ollama** | Free, offline | Install [Ollama](https://ollama.com), run `ollama pull llama3.2`, then `--provider ollama` |
| **OpenRouter** | Free `:free` models | Set `OPENROUTER_API_KEY` |
| **none** | Free | No AI. The message is built from file names, e.g. `chore: update App.jsx` |

If the AI is unreachable, git-autopilot falls back to the file-name message instead of failing.

## Safety and privacy

- **No review step.** It commits automatically, so use `--branch auto-save` or `--check` if your work-in-progress code should not reach `main`.
- Never commits `.env`, `*.pem`, `*.key`, `id_rsa*` and similar files, even if they are missing from `.gitignore`.
- Respects your `.gitignore`.
- Only reads these keys from `.env` files: `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_URL`, `AUTOPILOT_PROVIDER`, `AUTOPILOT_MODEL`.
- **Your code diff is sent to the AI provider you choose** (lock files excluded, truncated to 20,000 characters). For private code use `--provider ollama` (stays on your machine) or `--files-only`.
- If GitHub rejects a push because the remote has new commits, it runs `git pull --rebase` and retries. On a conflict it aborts the rebase and asks you to resolve it manually.

## Troubleshooting

- **`not a git repository`**: run it on your project folder, not on the git-autopilot folder.
- **Paths with spaces on Windows**: wrap the path in quotes: `"C:\Users\me\My Project"`.
- **`AI request failed (404...)`**: the model name is outdated. Pass a current one with `--model`.
- **Push asks for login or is denied**: run `git push` manually once and sign in, then retry.

## Development

```bash
git clone https://github.com/guptamayank9/git-autopilot
cd git-autopilot
npm install
npm test
node bin/git-autopilot.js --help
```

Pull requests are welcome.

## License

[MIT](LICENSE) © Mayank Kumar Gupta
