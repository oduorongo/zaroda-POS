"use client";

import { useEffect, useState } from "react";
import { cn } from "../lib/cn";

/**
 * "← Back" at the left of every top bar: the previous page, like the browser's back button. Hidden on the app's home page
 * (homeHref) and when there is nothing to go back to (a link opened in a new tab). Checked after every render, so it follows
 * client-side navigation too.
 */
export function BackButton({ homeHref, className }: { homeHref?: string; className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const home = (homeHref ?? "").replace(/\/+$/, "") || "/";
    setShow(window.history.length > 1 && path !== home);
  });
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      aria-label="Back"
      title="Back"
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border border-white/30 bg-transparent px-2 py-1 text-xs font-medium text-white hover:bg-white/10 sm:text-sm", className)}
    >
      <span aria-hidden="true">←</span>
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}
