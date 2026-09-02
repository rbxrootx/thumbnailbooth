import { Suspense, lazy, useEffect, useState } from "react";
import { motion } from "motion/react";
import { useStore } from "./lib/store.js";
import { Composer } from "./routes/Composer.js";
import { History } from "./routes/History.js";
import { Settings } from "./routes/Settings.js";
// React Flow is heavy and most sessions never open the flat plan.
const Canvas = lazy(() => import("./routes/Canvas.js").then((m) => ({ default: m.Canvas })));
import { Onboarding } from "./routes/Onboarding.js";
import { RegistrationTarget } from "./components/PressMarks.js";
import { Gear, Grid, Sheet, Stack, Warn } from "./components/Icons.js";
import { settle } from "./design/motion.js";

type Route = "compose" | "canvas" | "history" | "setup";

const TABS: Array<{ id: Route; label: string; icon: React.ReactNode }> = [
  { id: "compose", label: "Compose", icon: <Sheet /> },
  { id: "canvas", label: "Flat plan", icon: <Grid /> },
  { id: "history", label: "History", icon: <Stack /> },
  { id: "setup", label: "Setup", icon: <Gear /> },
];

export function App() {
  const { ready, bootError, config, boot } = useStore();
  const [route, setRoute] = useState<Route>("compose");

  useEffect(() => { void boot(); }, [boot]);

  const anyKey = config.gemini.configured || config.openai.configured;

  if (!ready) return <Booting />;

  if (bootError) {
    return (
      <main className="grid h-dvh place-items-center p-6">
        <div className="sheet-shadow max-w-[440px] bg-stock px-7 py-6 text-ink">
          <p className="flex items-start gap-2 text-[13.5px] leading-relaxed">
            <Warn className="mt-0.5 text-red-ink" />
            <span>
              Couldn&rsquo;t reach the local server: {bootError}. Try stopping ThumbnailBooth in
              your terminal and running <span className="tabular">npx thumbnailbooth</span> again.
            </span>
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surround-700">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-surround-950/60 bg-surround-900 px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-stock"><RegistrationTarget size={20} done /></span>
          <span className="truncate text-[13px] font-bold tracking-[-0.01em]" style={{ fontStretch: "90%" }}>
            ThumbnailBooth
          </span>
        </div>

        {anyKey ? (
          <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRoute(tab.id)}
                aria-current={route === tab.id ? "page" : undefined}
                title={tab.label}
                aria-label={tab.label}
                className={`relative flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 text-[12.5px] transition-colors sm:px-3 ${
                  route === tab.id ? "text-stock" : "text-surround-300 hover:text-stock"
                }`}
              >
                {tab.icon}
                {/* Labels give way to icons before the bar can overflow. */}
                <span className="hidden sm:inline">{tab.label}</span>
                {route === tab.id ? (
                  <motion.span
                    layoutId="tab-rule"
                    className="absolute inset-x-2 -bottom-px h-px bg-cyan"
                    transition={settle}
                  />
                ) : null}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          {!anyKey ? <Onboarding />
              : route === "compose" ? <Composer />
              : route === "canvas" ? (
                <Suspense fallback={<PlateLoading />}><Canvas /></Suspense>
              )
              : route === "history" ? <History onOpen={() => setRoute("compose")} />
            : <Settings />}
        </div>
      </main>
    </div>
  );
}

function PlateLoading() {
  return (
    <div className="grid flex-1 place-items-center text-surround-400">
      <RegistrationTarget size={30} active />
    </div>
  );
}

/** The press warming up: the target holds until the app has its bearings. */
function Booting() {
  return (
    <div className="grid min-h-dvh place-items-center bg-surround-900 text-surround-400">
      <RegistrationTarget size={36} active />
    </div>
  );
}
