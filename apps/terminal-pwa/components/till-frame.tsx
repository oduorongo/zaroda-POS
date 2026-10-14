import type { ReactNode } from "react";
import { BottomRibbon, TopRibbon } from "@zaroda/ui";

// The till is a full-screen app, so the shared navy ribbons frame it instead of floating over it: the top
// one carries the logo and "Till", the bottom one the Powered by line, and the screen sits between them.
export function TillFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <TopRibbon appName="Till" homeHref="/" className="relative" />
      <div id="till-screen" className="min-h-0 flex-1 overflow-auto">
        {children}
      </div>
      <BottomRibbon className="relative" />
    </div>
  );
}
