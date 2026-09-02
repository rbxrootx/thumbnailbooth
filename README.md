# ThumbnailBooth

Make Roblox thumbnails on your own machine, with your own API key.

No subscription, no upload of your work to anyone's server, no watermark. You pay
Google or OpenAI directly — usually a few cents an image — and the tool shows you
the price before you spend it.

## Running it

**From this repo** — no npm publish needed:

| | |
|---|---|
| **Windows** | double-click **`setup.bat`** |
| **macOS / Linux** | `./setup.sh` |

That checks your Node version, installs dependencies, builds, and starts the app.
First run takes about a minute; after that it starts immediately.

Once it is published to npm, this will also work:

```sh
npx thumbnailbooth
```

Either way it opens in your browser at `http://127.0.0.1:4270`.

---

## What it does

- **Knows what a Roblox thumbnail is.** Roblox-accurate avatar rendering is built into
  the house style, and the delivery sizes are the real ones: 1920×1080 for gallery
  images, 512×512 for icons with the 420×420 safe zone drawn on the proof so your art
  doesn't get cut off by the rounded corners.
- **Built for rerolling.** The loop is generate → look → tweak a word → generate again.
  Earlier takes stay on screen to compare against, and editing the concept after a
  render stamps the sheet REVISED so you know what you're looking at.
- **Two providers.** Google's Nano Banana Pro and the Flash Image models, or OpenAI's
  GPT Image 2. Switch per job.
- **Shows the cost up front**, per job, before you press Generate.
- **Everything stays local.** History, saved setups, and images live in
  `~/.thumbnailbooth` on your computer.

## Getting a key

You need a key from at least one provider. The app walks you through it on first run.

- **Google Gemini** — free to create at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
  Recommended to start with: Nano Banana Pro renders title text better than anything else.
- **OpenAI** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
  Needs billing set up on your OpenAI account.

## Roughly what it costs

Per image, at the time of writing. The app estimates this live for whatever you have
set up, and providers bill by token, so treat these as close approximations.

| Model | 1K | 2K | 4K |
|---|---|---|---|
| Nano Banana Pro (`gemini-3-pro-image`) | $0.134 | $0.134 | $0.24 |
| Nano Banana 2 (`gemini-3.1-flash-image`) | $0.067 | $0.101 | $0.151 |
| Flash Lite (`gemini-3.1-flash-lite-image`) | $0.034 | — | — |
| GPT Image 2 (`gpt-image-2`) | $0.03 | $0.05 | $0.08 |

## Use it from an AI agent

ThumbnailBooth speaks **MCP** and has a **plain CLI**, so an agent can generate
thumbnails for you.

### Any agent that can run a command

```sh
thumbnailbooth generate --concept "a noob lifting a giant golden dumbbell" \
                        --title "STRONGEST PUNCH SIMULATOR" \
                        --variants 2 --out ./thumbnails --json
```

`--json` prints a machine-readable result to stdout (progress goes to stderr, so
piping to `jq` is safe):

```json
{
  "ok": true,
  "job_id": "mtkeis99-9169e601",
  "paths": ["/Users/you/.thumbnailbooth/history/mtkeis99-9169e601/01.png"],
  "estimated_cost_usd": 0.134,
  "errors": []
}
```

Also available: `thumbnailbooth models --json` and `thumbnailbooth history --json`.

### Claude Desktop, Claude Code, Cursor, Codex (MCP over stdio)

Add to your MCP config — `claude_desktop_config.json`, `.cursor/mcp.json`, or
equivalent:

```json
{
  "mcpServers": {
    "thumbnailbooth": {
      "command": "node",
      "args": ["C:\\path\\to\\thumbnailbooth\\bin\\thumbnailbooth.js", "mcp"],
      "env": { "GEMINI_API_KEY": "your-key" }
    }
  }
}
```

On macOS or Linux the path is just `/path/to/thumbnailbooth/bin/thumbnailbooth.js`.
If you have already saved a key in the app's Setup screen you can omit `env`.

Four tools are exposed:

| Tool | What it does | Costs money |
|---|---|---|
| `generate_thumbnail` | Renders thumbnails, returns file paths | **yes** |
| `estimate_cost` | Price of a generation before running it | no |
| `list_models` | Models, prices, and which keys are configured | no |
| `list_history` | Past jobs with their paths and costs | no |

`generate_thumbnail` returns **file paths, not inline image data** — a 2K PNG is
several megabytes and pasting that into a model's context is pure waste. Pass
`return_images: true` if you genuinely need the bytes inline.

### ChatGPT

ChatGPT **cannot** launch a local stdio MCP server. It only connects to remote
**HTTPS** MCP endpoints, so it needs the HTTP transport plus a tunnel:

```sh
thumbnailbooth --mcp-http          # serves MCP at http://127.0.0.1:4270/mcp
```

Then expose that over HTTPS (OpenAI's Secure MCP Tunnel, or a tunnel of your
choice) and add the resulting URL under ChatGPT's Settings → Connectors in
developer mode. Custom connectors require a Plus, Pro, Business, Enterprise or
Edu plan, and a workspace admin has to allow them.

> **Be careful with `--mcp-http`.** That endpoint can spend money on your API
> key, so it is **off by default**. Requests carrying a non-loopback `Origin`
> are rejected to blunt DNS-rebinding from a web page, but a tunnel makes it
> reachable from the internet — only run it while you need it, and prefer a
> tunnel that requires authentication.

## Options

```
npx thumbnailbooth [options]

  --port <n>    Port to listen on         (default: 4270, or next free)
  --host <h>    Host to bind              (default: 127.0.0.1)
  --no-open     Don't open a browser
  --help        Show this
  --version     Print the version
```

## Where your things are kept

```
~/.thumbnailbooth/
  config.json           your API keys and last-used settings
  history/index.ndjson  one line per job
  history/<job>/        the images from that job
  workflows/            saved setups
```

**About the keys.** They are written to `config.json` inside your user folder, with
owner-only permissions on macOS and Linux (Windows relies on your user profile's own
access controls), and they are sent to Google and OpenAI to make your images and
nowhere else. The file is **not encrypted**, so treat it like any other file holding a
password. Deleting a key in Setup removes it from the file.

Nothing is uploaded anywhere, there is no account, and there is no telemetry.

## Requirements

Node.js 20 or newer. Works on macOS, Windows and Linux. There are no native
dependencies to compile.

## Building from source

```sh
git clone <this repo> && cd thumbnailbooth
npm install
npm run dev        # UI on :4270, API on :4271, both hot-reloading
npm run build      # production build into dist/
npm start          # run the built app
npm run test:all   # provider fixtures + a real MCP handshake
```

Tests need no API key and cost nothing: `test/mock-provider.ts` is a stand-in
provider that streams real PNGs, so the whole pipeline can be exercised offline.

```sh
MOCK_STEP_MS=1500 npx tsx test/mock-provider.ts
GEMINI_API_KEY=anything GEMINI_BASE_URL=http://127.0.0.1:4399 npm start
```

## Known limits

- Generation is synchronous. Both providers offer a batch mode at half price, but with
  up to a 24-hour turnaround, which doesn't suit a tool built around rerolling. It may
  arrive later as an explicit overnight option.
- Uploading finished thumbnails straight to Roblox is not implemented.

## Licence

MIT.
