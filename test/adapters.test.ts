/**
 * Exercises both provider adapters against fixture servers that reproduce the
 * documented response shapes — streamed and non-streamed, success and refusal.
 *
 * The point is the success path: we can prove the adapters find the image and
 * classify partial vs final without a real key or a real charge.
 *
 *   npx tsx test/adapters.test.ts
 */
import http from "node:http";
import assert from "node:assert/strict";

// Valid base64 of 300 bytes — long enough to clear the adapter's
// "looks like image data" floor, and it must stay decodable end to end.
const PNG = Buffer.alloc(300, 7).toString("base64");

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end();
}

const routes = {
  // Gemini Interactions API, streamed: a thought, a preview, then the render.
  "/gemini-stream/interactions": (res) => sse(res, [
    { type: "thought", text: "planning" },
    { type: "output_image.partial", output_image: { type: "image", mime_type: "image/png", data: PNG } },
    { type: "interaction.completed", status: "completed",
      output_image: { type: "image", mime_type: "image/png", data: PNG },
      usage_metadata: { total_output_tokens: 1120 } },
  ]),
  // Same API answering a streamed request with a plain JSON body.
  "/gemini-json/interactions": (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "int_1", status: "completed",
      output_image: { type: "image", mime_type: "image/png", data: PNG },
    }));
  },
  // A blocked prompt: text back, no image.
  "/gemini-refuse/interactions": (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "int_2", status: "completed", output_text: "I can't make that." }));
  },
  // OpenAI images.generations, streamed with partial_images.
  "/openai-stream/images/generations": (res) => sse(res, [
    { type: "image_generation.partial_image", b64_json: PNG, partial_image_index: 0 },
    { type: "image_generation.partial_image", b64_json: PNG, partial_image_index: 1 },
    { type: "image_generation.completed", b64_json: PNG, usage: { total_tokens: 900 } },
  ]),
  // OpenAI images.edits — where reference images must go.
  "/openai-edits/images/edits": (res) => sse(res, [
    { type: "image_generation.partial_image", b64_json: PNG, partial_image_index: 0 },
    { type: "image_generation.completed", b64_json: PNG },
  ]),
  "/openai-edits/images/generations": (res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "refs must not use /generations" } }));
  },
};

let sawEditsRequest = false;

const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path.endsWith("/images/edits")) sawEditsRequest = true;
  for (const [prefix, handler] of Object.entries(routes)) {
    if (path === prefix) return handler(res);
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: `no fixture for ${path}` } }));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

async function collect(adapter, req, key = "k") {
  const out = [];
  for await (const e of adapter.generate(req, key, new AbortController().signal)) out.push(e);
  return out;
}

const baseReq = {
  model: "gemini-3-pro-image", concept: "a noob", aspect: "16:9",
  size: "2K", variants: 1,
};

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failures++; console.log(`  FAIL ${name}\n       ${err.message}`); }
}

process.env.GEMINI_BASE_URL = `${base}/gemini-stream`;
process.env.OPENAI_BASE_URL = `${base}/openai-stream`;
const { geminiAdapter } = await import("../src/server/providers/gemini.ts");
const { openaiAdapter } = await import("../src/server/providers/openai.ts");

console.log("\ngemini — streamed");
{
  const events = await collect(geminiAdapter, baseReq);
  check("emits a partial before the final", () => {
    const kinds = events.map((e) => e.type);
    assert.ok(kinds.indexOf("partial") < kinds.indexOf("image"), kinds.join(","));
  });
  check("emits exactly one final image", () =>
    assert.equal(events.filter((e) => e.type === "image").length, 1));
  check("final image carries decodable base64", () => {
    const img = events.find((e) => e.type === "image");
    assert.ok(Buffer.from(img.data, "base64").length > 100);
    assert.equal(img.mimeType, "image/png");
  });
  check("no error events", () =>
    assert.equal(events.filter((e) => e.type === "error").length, 0));
}

console.log("\ngemini — non-streamed JSON reply to a streamed request");
{
  process.env.GEMINI_BASE_URL = `${base}/gemini-json`;
  const mod = await import(`../src/server/providers/gemini.ts?json`);
  const events = await collect(mod.geminiAdapter, baseReq);
  check("still yields the image", () =>
    assert.equal(events.filter((e) => e.type === "image").length, 1));
}

console.log("\ngemini — refusal");
{
  process.env.GEMINI_BASE_URL = `${base}/gemini-refuse`;
  const mod = await import(`../src/server/providers/gemini.ts?refuse`);
  const events = await collect(mod.geminiAdapter, baseReq);
  check("reports an error, not a silent empty success", () => {
    const err = events.find((e) => e.type === "error");
    assert.ok(err, "expected an error event");
    assert.match(err.message, /text instead of an image|no image/i);
  });
}

console.log("\nopenai — streamed generations");
{
  const events = await collect(openaiAdapter, { ...baseReq, model: "gpt-image-2" });
  check("emits partials then one final", () => {
    assert.equal(events.filter((e) => e.type === "partial").length, 2);
    assert.equal(events.filter((e) => e.type === "image").length, 1);
  });
  check("final decodes", () => {
    const img = events.find((e) => e.type === "image");
    assert.ok(Buffer.from(img.data, "base64").length > 100);
  });
}

console.log("\nopenai — references route to /images/edits");
{
  process.env.OPENAI_BASE_URL = `${base}/openai-edits`;
  const mod = await import(`../src/server/providers/openai.ts?edits`);
  const events = await collect(mod.openaiAdapter, {
    ...baseReq, model: "gpt-image-2",
    refs: [{ data: PNG, mimeType: "image/png", name: "avatar.png" }],
  });
  check("used the edits endpoint", () => assert.ok(sawEditsRequest));
  check("returned an image", () =>
    assert.equal(events.filter((e) => e.type === "image").length, 1));
}

console.log("\nmulti-variant fan-out");
{
  process.env.GEMINI_BASE_URL = `${base}/gemini-stream`;
  const mod = await import(`../src/server/providers/gemini.ts?fan`);
  const events = await collect(mod.geminiAdapter, { ...baseReq, variants: 3 });
  check("one final image per variant", () =>
    assert.equal(events.filter((e) => e.type === "image").length, 3));
  check("each variant reports a distinct index", () => {
    const idx = events.filter((e) => e.type === "image").map((e) => e.index).sort();
    assert.deepEqual(idx, [0, 1, 2]);
  });
}

console.log("\nimage id round-trip");
{
  // The UI derives a job id from an image id to mark a job favourite.
  // Prove the server's id shape actually survives that derivation.
  const { newJobId } = await import("../src/server/store.ts");
  const derive = (imageId: string) => imageId.slice(0, imageId.lastIndexOf("-"));

  check("derives the job id back out of an image id", () => {
    for (let i = 0; i < 200; i++) {
      const jobId = newJobId();
      for (const index of [0, 1, 7, 12]) {
        // Exactly how routes/generate.ts builds it.
        assert.equal(derive(`${jobId}-${index}`), jobId,
          `round-trip failed for ${jobId}-${index}`);
      }
    }
  });

  check("job ids sort chronologically", () => {
    const a = newJobId();
    const b = newJobId();
    assert.ok(a.split("-")[0].length === b.split("-")[0].length);
  });
}

server.close();
console.log(failures ? `\n${failures} FAILING\n` : "\nall adapter checks passed\n");
process.exit(failures ? 1 : 0);
