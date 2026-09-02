import { KeyRow } from "./Settings.js";
import { RegistrationTarget } from "../components/PressMarks.js";

/**
 * First run. This audience has never made an API key, so the screen explains
 * what a key is, why it is needed, and that it costs cents — before asking
 * for one. One decision, no dead ends.
 */
export function Onboarding() {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="sheet-shadow w-full max-w-[560px] bg-stock text-ink">
        <div className="flex items-center gap-3 border-b border-stock-rule px-7 py-5">
          <span className="text-ink"><RegistrationTarget size={26} done /></span>
          <h1 className="text-[17px] font-bold tracking-[-0.015em]" style={{ fontStretch: "90%" }}>
            Set up the press
          </h1>
        </div>

        <div className="border-b border-stock-rule px-7 py-5 text-[13.5px] leading-relaxed text-ink-70">
          <p>
            ThumbnailBooth makes your thumbnails using Google&rsquo;s or OpenAI&rsquo;s image
            models. You bring your own key, so you pay them directly — usually a few cents
            per image — and nothing goes through us.
          </p>
          <p className="mt-3">
            A key is a long password that lets this app ask for images on your account. It
            takes about a minute to get one, and it stays on this computer.
          </p>
        </div>

        <KeyRow
          id="gemini"
          name="Google Gemini"
          where="aistudio.google.com/app/apikey"
          url="https://aistudio.google.com/app/apikey"
          note="Recommended to start. Free to create, and Nano Banana Pro renders title text better than anything else."
        />

        <details className="border-t border-stock-rule/70">
          <summary className="legend cursor-pointer px-7 py-4 text-ink-50 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            I&rsquo;d rather use OpenAI
          </summary>
          <div className="-mt-2">
            <KeyRow
              id="openai"
              name="OpenAI"
              where="platform.openai.com/api-keys"
              url="https://platform.openai.com/api-keys"
              note="Runs GPT Image 2. Requires billing set up on your OpenAI account."
            />
          </div>
        </details>
      </div>
    </div>
  );
}
