import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MODELS, ROBLOX_PRESETS, estimateCost, getModel } from "../shared/models.js";
import type { AspectRatio, RefImage, SizeTier } from "../shared/types.js";
import { JobError, normalizeRequest, runJob } from "./job.js";
import * as store from "./store.js";

/**
 * ThumbnailBooth as a tool an agent can call.
 *
 * Images are returned as file paths rather than inline base64 by default: a
 * 2K PNG is several megabytes, and pasting that into a model's context is
 * both expensive and useless when the agent can just open the file.
 */

const ASPECTS = [
  "16:9", "1:1", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9",
] as const;

const MODEL_IDS = MODELS.map((m) => m.id) as [string, ...string[]];

async function loadReference(file: string, role: RefImage["role"]): Promise<RefImage> {
  const resolved = path.resolve(file);
  const data = await fs.readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const mimeType =
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".webp" ? "image/webp"
    : ext === ".gif" ? "image/gif"
    : "image/png";
  return { data: data.toString("base64"), mimeType, name: path.basename(resolved), role };
}

export function createMcpServer(version: string): McpServer {
  const server = new McpServer({ name: "thumbnailbooth", version });

  server.registerTool(
    "generate_thumbnail",
    {
      title: "Generate a Roblox thumbnail",
      description:
        "Generate Roblox game thumbnails or icons with Google Gemini or OpenAI image models. " +
        "Writes PNG files to disk and returns their absolute paths — read those paths to view " +
        "the images. Costs real money on the user's own API key (a few cents per image); the " +
        "response reports the estimated spend. Use estimate_cost first if the user cares about " +
        "the price. Reference images contribute lighting and colour only unless a reference is " +
        "given the role 'character'.",
      inputSchema: {
        concept: z
          .string()
          .describe("What is happening in the picture, in plain words. Required unless references are supplied."),
        title: z
          .string()
          .optional()
          .describe("Bold 3D title text drawn into the image. Omit to leave clean space for text added later."),
        model: z
          .enum(MODEL_IDS)
          .optional()
          .describe("Defaults to gemini-3-pro-image (best text rendering). Call list_models for the full list."),
        aspect: z.enum(ASPECTS).optional().describe("Defaults to 16:9, the Roblox gallery thumbnail shape. Use 1:1 for a game icon."),
        size: z.enum(["512px", "1K", "2K", "4K"]).optional().describe("Defaults to 2K. Larger costs more."),
        variants: z.number().int().min(1).max(8).optional().describe("How many different takes to render. Defaults to 1."),
        style_rules: z.string().optional().describe("Overrides the built-in Roblox house style. Most callers should omit this."),
        references: z
          .array(
            z.object({
              path: z.string().describe("Absolute or relative path to a local image file."),
              role: z
                .enum(["style", "character", "layout"])
                .optional()
                .describe(
                  "style (default) takes only lighting and colour, and nothing from the picture " +
                  "will appear in the output. character puts that avatar in the shot. layout " +
                  "copies framing only.",
                ),
            }),
          )
          .optional()
          .describe("Local image files to guide the render."),
        return_images: z
          .boolean()
          .optional()
          .describe("Also return the images inline as base64. Off by default — the files are several MB each."),
      },
    },
    async (args) => {
      const refs = await Promise.all(
        (args.references ?? []).map((ref) =>
          loadReference(ref.path, ref.role === "character" ? "subject"
            : ref.role === "layout" ? "composition" : "style"),
        ),
      );

      const request = normalizeRequest({
        concept: args.concept,
        title: args.title,
        model: args.model,
        aspect: args.aspect as AspectRatio | undefined,
        size: args.size as SizeTier | undefined,
        variants: args.variants,
        styleRules: args.style_rules,
        refs,
      });

      try {
        const result = await runJob(request);

        const summary = result.images.length
          ? `Rendered ${result.images.length} image${result.images.length > 1 ? "s" : ""} ` +
            `with ${result.modelLabel} at ${request.aspect} ${request.size}. ` +
            `Estimated cost $${result.estimatedCost.toFixed(3)}.\n\n` +
            result.images.map((i) => i.path).join("\n")
          : `No image was produced. ${result.errors[0] ?? "The provider returned nothing."}`;

        const content: Array<Record<string, unknown>> = [{ type: "text", text: summary }];

        if (args.return_images) {
          for (const image of result.images) {
            const bytes = await fs.readFile(image.path);
            content.push({ type: "image", data: bytes.toString("base64"), mimeType: image.mimeType });
          }
        }

        return {
          content,
          isError: result.images.length === 0,
          structuredContent: {
            job_id: result.jobId,
            directory: result.dir,
            paths: result.images.map((i) => i.path),
            estimated_cost_usd: result.estimatedCost,
            model: result.model,
            errors: result.errors,
          },
        } as never;
      } catch (err) {
        const message = err instanceof JobError
          ? err.message
          : `Generation failed: ${(err as Error).message}`;
        return { content: [{ type: "text", text: message }], isError: true } as never;
      }
    },
  );

  server.registerTool(
    "list_models",
    {
      title: "List available image models",
      description:
        "The image models this install can use, with their price per image, supported aspect " +
        "ratios and sizes, and which provider key each one needs.",
      inputSchema: {},
    },
    async () => {
      const config = await store.configStatus();
      const rows = MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        key_configured: config[m.provider].configured,
        aspects: m.aspects,
        sizes: m.sizes,
        max_references: m.maxRefs,
        price_per_image_usd: Object.fromEntries(
          m.sizes.map((size) => [size, estimateCost(m.id, size, 1)]),
        ),
        notes: m.blurb,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { models: rows, roblox_presets: ROBLOX_PRESETS },
      } as never;
    },
  );

  server.registerTool(
    "estimate_cost",
    {
      title: "Estimate what a generation will cost",
      description: "Returns the estimated USD cost before anything is spent. Costs nothing to call.",
      inputSchema: {
        model: z.enum(MODEL_IDS).optional(),
        size: z.enum(["512px", "1K", "2K", "4K"]).optional(),
        variants: z.number().int().min(1).max(8).optional(),
      },
    },
    async (args) => {
      const model = args.model ?? "gemini-3-pro-image";
      const size = (args.size ?? "2K") as SizeTier;
      const variants = args.variants ?? 1;
      const cost = estimateCost(model, size, variants);
      const spec = getModel(model);
      return {
        content: [{
          type: "text",
          text: `${variants} x ${size} on ${spec?.label ?? model} is about $${cost.toFixed(3)}.`,
        }],
        structuredContent: { model, size, variants, estimated_cost_usd: cost },
      } as never;
    },
  );

  server.registerTool(
    "list_history",
    {
      title: "List past generations",
      description:
        "Previously generated thumbnails on this machine, newest first, with their concepts, " +
        "file paths and what they cost.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    async (args) => {
      const entries = await store.readHistory(args.limit ?? 20);
      const rows = entries.map((e) => ({
        job_id: e.id,
        created_at: e.createdAt,
        concept: e.request.concept,
        title: e.request.title,
        model: e.modelLabel,
        aspect: e.request.aspect,
        size: e.request.size,
        favorite: Boolean(e.favorite),
        estimated_cost_usd: e.usage?.estimatedCost ?? 0,
        paths: e.images.map((i) => path.join(store.jobDir(e.id), i.file ?? "")),
        error: e.error,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { jobs: rows },
      } as never;
    },
  );

  return server;
}
