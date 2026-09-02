# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + Vite + TypeScript + Tailwind v4 + Motion for the UI; Hono on Node for a
local server. Distributed on npm and run with `npx thumbnailbooth`, which starts the
server on 127.0.0.1 and opens a browser. Deliberately zero native dependencies — a
failed native build is the most common way an npx tool breaks on a stranger's machine.
Chosen in conversation with the user, who ruled out Electron and Tauri for v1 on the
grounds that shipping a signed desktop app costs $99/yr and blocks free distribution.

## Users

Roblox developers of any experience level, running the tool on their own PC. The
primary user is assumed to have **no API background**: they have never created an API
key, may not know what Gemini or OpenAI are, and will judge the tool inside the first
minute. Many are teenagers. They arrive wanting one thing — a thumbnail that gets
clicks — and every step between opening the app and seeing an image is friction they
did not ask for.

They are not designers. They are competing in a grid of thumbnails where the only
currency is whether a stranger's thumb stops moving.

## Product Purpose

Generate Roblox game thumbnails and icons locally, using the user's own API keys, with
no subscription, no upload of their work to a third party, and no watermark.

Success is a user going from `npx thumbnailbooth` to a thumbnail they would actually
publish, without reading documentation.

## Positioning

Three things a general-purpose image tool cannot truthfully claim:

1. **It knows what a Roblox thumbnail is.** Roblox-accurate avatar rendering, the
   1920×1080 gallery format, and the 512×512 icon with its 420×420 corner-rounding
   safe zone are built in, not prompt-engineered by the user each time.
2. **It runs on the user's own keys, locally.** Nothing is uploaded to a service; the
   images and keys never leave the machine. There is no subscription and no per-image
   markup over provider cost.
3. **It shows the price before spending it.** Cost is estimated per generation, up
   front, because the audience is spending their own money and often very little of it.

## Operating Context

The dominant loop is **iterate hard on one concept**, confirmed by the user: generate,
look, tweak the wording, generate again, and repeat until one image wins. Rerolling,
comparing a new attempt against the previous one, and editing the prompt without
losing your place are the core motions — not bulk production.

Fanning out several variants at once exists to serve that loop (see several readings of
one idea), not as a separate bulk-production mode.

Work happens on a desktop or laptop browser served from localhost. Sessions are
bursty: a run of many generations in one sitting, then nothing for days.

## Capabilities and Constraints

- Two providers, user-supplied keys: **Google Gemini** (Interactions API, `gemini-3-pro-image`
  "Nano Banana Pro" and the 3.1 Flash Image family) and **OpenAI** (`gpt-image-2`).
- Generation is synchronous. Batch APIs are 50% cheaper but carry up to a 24-hour
  turnaround, which the user explicitly rejected for v1 as incompatible with the
  iterate-hard loop.
- Both providers stream progressive preview frames during a render.
- Gemini takes an aspect ratio and a size tier natively; OpenAI takes explicit pixel
  dimensions and rejects any edge not divisible by 16 — notably **1920×1080 is not
  directly generatable** and must be rendered at an exact-aspect size and downscaled.
- References: up to 14 images on Gemini, 16 on OpenAI, where they force the request
  onto a different endpoint (`/images/edits`).
- Keys are stored server-side at `~/.thumbnailbooth/config.json`, mode 0600, and are
  never sent to the browser. The file is **not encrypted**; this must be stated plainly
  to users rather than implied to be secure storage.
- History and saved workflows are plain files on disk. No account, no cloud, no telemetry.
- Undecided: whether the tool ever uploads directly to Roblox. Out of scope for v1.

## Brand Commitments

The name is **ThumbnailBooth**. The user confirmed there is no binding existing brand
and gave free rein on the visual world; the warm near-black ground and cream primary
action from their earlier prototype are a useful starting point, not a contract.

## Evidence on Hand

- Three screenshots of the user's earlier browser-based prototype, showing the linear
  form (API key → concept → title → output → references → style rules → generate).
- Verified provider pricing and endpoint behaviour researched 2026-08-30, recorded in
  `src/shared/models.ts`.
- **No** testimonials, user counts, benchmarks, or case studies exist. None may be
  invented. The tool is unreleased.

## Product Principles

1. **Nothing before the first image.** Every step between launching the app and seeing
   a thumbnail must justify itself. The setup flow is the product's hardest problem,
   not an afterthought.
2. **Rerolling is the primary verb.** The design optimises for the second, fifth, and
   twentieth attempt, not the first. Getting back to "generate again, slightly
   different" must be effortless and must never lose prior work.
3. **Never spend the user's money silently.** Show the cost before the click and what
   was spent after it. This audience notices cents.
4. **Explain in the user's language, never the API's.** No raw provider errors, no
   jargon. "Your key was rejected — it may be revoked" beats a 401.
5. **The user's work stays theirs.** Local by default, exportable always, no lock-in
   to the tool's own formats.

## Accessibility & Inclusion

Respect `prefers-reduced-motion` throughout — the interface leans heavily on motion,
and it must degrade to a still, fully usable tool. Keyboard operation for the core
generate/reroll loop. Text and controls must remain legible on the low-quality laptop
displays this audience often has, which rules out very low contrast greys on the dark
ground.
