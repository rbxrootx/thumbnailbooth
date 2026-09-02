/**
 * Drives the shipped MCP server with the SDK's own client, over the same
 * stdio transport Claude Desktop and Cursor use. If this passes, a real
 * client can list and call these tools.
 *
 *   npm run test:mcp
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = process.env.MCP_TEST_HOME ?? path.join(root, ".mcp-test-home");

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failures++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "bin", "thumbnailbooth.js"), "mcp"],
  env: {
    ...process.env,
    THUMBNAILBOOTH_HOME: scratch,
    GEMINI_API_KEY: "fake-for-mock",
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL ?? "http://127.0.0.1:4399",
  } as Record<string, string>,
});

const client = new Client({ name: "thumbnailbooth-test", version: "0" });
await client.connect(transport);

console.log("\nhandshake");
{
  const caps = client.getServerCapabilities();
  const info = client.getServerVersion();
  check("server advertises tools", () => assert.ok(caps?.tools, JSON.stringify(caps)));
  check("server identifies itself", () => assert.equal(info?.name, "thumbnailbooth"));
}

console.log("\ntools/list");
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
{
  check("exposes the expected tools", () =>
    assert.deepEqual(names, ["estimate_cost", "generate_thumbnail", "list_history", "list_models"]));
  check("every tool has a description an agent can act on", () =>
    tools.forEach((t) => assert.ok((t.description ?? "").length > 40, `${t.name} description too thin`)));
  check("generate_thumbnail declares its inputs", () => {
    const gen = tools.find((t) => t.name === "generate_thumbnail")!;
    const props = Object.keys((gen.inputSchema as { properties?: object }).properties ?? {});
    for (const want of ["concept", "title", "model", "aspect", "size", "variants", "references"]) {
      assert.ok(props.includes(want), `missing input: ${want}`);
    }
  });
  check("generate_thumbnail warns that it costs money", () => {
    const gen = tools.find((t) => t.name === "generate_thumbnail")!;
    assert.match(gen.description ?? "", /cost|money|cents/i);
  });
}

console.log("\ntools/call — free tools");
{
  const res = await client.callTool({ name: "estimate_cost", arguments: { size: "2K", variants: 4 } });
  check("estimate_cost returns a number", () => {
    const sc = (res as { structuredContent?: { estimated_cost_usd?: number } }).structuredContent;
    assert.equal(sc?.estimated_cost_usd, 0.536);
  });

  const models = await client.callTool({ name: "list_models", arguments: {} });
  check("list_models returns the catalogue", () => {
    const sc = (models as { structuredContent?: { models?: unknown[] } }).structuredContent;
    assert.equal(sc?.models?.length, 5);
  });
}

console.log("\ntools/call — generate against the offline mock");
{
  const res = await client.callTool({
    name: "generate_thumbnail",
    arguments: { concept: "a noob lifting a giant dumbbell", variants: 2 },
  });
  const sc = (res as { structuredContent?: { paths?: string[]; estimated_cost_usd?: number } }).structuredContent;

  check("returns file paths, not megabytes of base64", () => {
    assert.equal(sc?.paths?.length, 2);
    const text = JSON.stringify((res as { content: unknown }).content);
    assert.ok(text.length < 4000, `content was ${text.length} bytes — images should not be inlined by default`);
  });
  check("paths exist on disk", async () => {
    const fs = await import("node:fs");
    sc!.paths!.forEach((p) => assert.ok(fs.existsSync(p), `missing ${p}`));
  });
  check("reports the spend", () => assert.equal(sc?.estimated_cost_usd, 0.268));
}

console.log("\nerror handling");
{
  const res = await client.callTool({ name: "generate_thumbnail", arguments: { concept: "" } });
  check("empty concept is a tool error, not a crash", () =>
    assert.equal((res as { isError?: boolean }).isError, true));
}

await client.close();
console.log(failures ? `\n${failures} FAILING\n` : "\nall MCP checks passed\n");
process.exit(failures ? 1 : 0);
