/**
 * A stand-in for the Gemini Interactions API that streams real PNGs slowly,
 * so the whole success path — press run, partial previews, continuous reveal,
 * files on disk — can be exercised without a key or a charge.
 *
 *   npx tsx test/mock-provider.ts            # listens on 4399
 *   GEMINI_BASE_URL=http://127.0.0.1:4399 npx thumbnailbooth
 */
import http from "node:http";
import zlib from "node:zlib";

/** Minimal PNG encoder — enough for honest test imagery, no native deps. */
function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c;
}

/** Blocky at low detail, sharp at high — so the reveal is actually visible. */
function frame(detail: number, seed: number, w = 512, h = 288): string {
  const block = Math.max(1, Math.round(64 / detail));
  return png(w, h, (x, y) => {
    const bx = Math.floor(x / block) * block;
    const by = Math.floor(y / block) * block;
    const u = bx / w, v = by / h;
    const wave = Math.sin((u * 6 + seed) * Math.PI) * Math.cos((v * 4 + seed) * Math.PI);
    return [
      Math.round(120 + 110 * wave),
      Math.round(90 + 90 * Math.sin((u * 3 + seed * 1.7) * Math.PI)),
      Math.round(160 + 80 * Math.cos((v * 5 + seed) * Math.PI)),
    ].map((n) => Math.max(0, Math.min(255, n))) as [number, number, number];
  }).toString("base64");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  if (!req.url?.includes("/interactions")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [] }));
    return;
  }

  const seed = Math.random() * 4;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  // A slow press: think, then two rough passes, then the finished sheet.
  await sleep(Number(process.env.MOCK_STEP_MS ?? 2500));
  send({ type: "thought", text: "composing" });
  await sleep(Number(process.env.MOCK_STEP_MS ?? 2500));
  send({ type: "output_image.partial", output_image: { mime_type: "image/png", data: frame(1, seed) } });
  await sleep(Number(process.env.MOCK_STEP_MS ?? 2500));
  send({ type: "output_image.partial", output_image: { mime_type: "image/png", data: frame(3, seed) } });
  await sleep(Number(process.env.MOCK_STEP_MS ?? 2500));
  send({
    type: "interaction.completed", status: "completed",
    output_image: { mime_type: "image/png", data: frame(24, seed, 1024, 576) },
    usage_metadata: { total_output_tokens: 1120 },
  });
  res.end();
});

server.listen(4399, "127.0.0.1", () => console.log("mock press on http://127.0.0.1:4399"));
