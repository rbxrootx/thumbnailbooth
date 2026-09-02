import type { GenerateRequest, RefImage } from "../shared/types.js";

/**
 * Turns Composer fields into the text the models actually see.
 * Both adapters share this so Gemini and OpenAI get equivalent instructions.
 */

/** The house style. Editable per-generation in the Composer's Style rules panel. */
export const DEFAULT_STYLE_RULES = `You are art-directing a Roblox game thumbnail that has to win a click in a crowded grid of competitors.

Rendering:
- Render Roblox-accurate avatars: blocky bodies, cylindrical limbs, distinct head shapes. Never draw realistic human anatomy or Minecraft-style voxels.
- Glossy, brightly lit 3D render. Punchy saturated colour, strong rim light, clean specular highlights.
- Bold simple background with depth blur so the subject separates instantly.

Composition:
- One clear focal subject reading at thumbnail scale. Test it as a 200px-wide image.
- Exaggerated readable emotion — shock, glee, smugness. Faces large enough to parse.
- Strong foreground/background contrast. Avoid busy edges and visual clutter.
- Leave the composition uncrowded near any text so titles stay legible.

Never include:
- Watermarks, signatures, UI chrome, borders, letterboxing, or the Roblox logo.
- Misspelled or garbled lettering. Any text must be spelled exactly as specified.`;

/**
 * What each reference is allowed to contribute.
 *
 * Style is the default and it is deliberately narrow: people attach an old
 * thumbnail wanting its *look*, and get its props and scenery copied instead.
 * Only an explicitly marked character reference may put its subject in frame.
 */
const ROLE_HINT: Record<NonNullable<RefImage["role"]>, string> = {
  style:
    "a STYLE reference only. Take from it the lighting, colour palette, contrast, " +
    "material finish, surface glossiness and overall render quality — and nothing else",
  subject:
    "the CHARACTER to feature. Reproduce this character's body, face, hair and outfit " +
    "accurately, and place them in the new scene described above",
  avatar:
    "the CHARACTER to feature. Reproduce this Roblox avatar's body, face, hair and outfit " +
    "accurately, and place them in the new scene described above",
  composition:
    "a LAYOUT reference. Match only where things sit in the frame and how the shot is " +
    "cropped — not its subject matter, objects or styling",
};

export interface BuiltPrompt {
  /** The user-turn text. */
  prompt: string;
  /** System instruction / developer message. */
  system: string;
}

export function buildPrompt(req: GenerateRequest): BuiltPrompt {
  const parts: string[] = [];

  parts.push(req.concept.trim());

  if (req.title?.trim()) {
    const title = req.title.trim();
    parts.push(
      `Render the text "${title}" into the image as a bold, chunky 3D title with a heavy outline and a drop shadow, placed so it never covers the subject's face. Spell it exactly: "${title}".`,
    );
  } else {
    parts.push(
      "Do not render any text, letters or numbers in the image. Leave clean, uncluttered negative space where a title could be added later.",
    );
  }

  if (req.refs?.length) {
    const refs = req.refs;
    const described = refs.map((ref, i) => {
      // Anything not explicitly marked otherwise contributes style only.
      const role = ref.role ?? "style";
      return `Image ${i + 1} is ${ROLE_HINT[role]}.`;
    });

    const styleOnly = refs.every((ref) => (ref.role ?? "style") === "style");
    const guard = styleOnly
      ? "Critically: the reference images are mood and lighting guides, not source material. " +
        "Do not reproduce, trace or collage any object, character, prop, background element, " +
        "scenery, logo or text that appears in them. Every object in your image must come from " +
        "the scene description above. If a reference shows a specific setting or props, ignore " +
        "them entirely and keep only the way it is lit and coloured."
      : "Take from each reference only what its role above permits. Do not copy objects, props, " +
        "backgrounds or text from a reference unless that reference is marked as the character " +
        "to feature.";

    parts.push(
      `You have been given ${refs.length} reference image${refs.length > 1 ? "s" : ""}. ` +
      `${described.join(" ")}\n\n${guard}`,
    );
  }

  return {
    prompt: parts.join("\n\n"),
    system: (req.styleRules?.trim() || DEFAULT_STYLE_RULES).trim(),
  };
}
