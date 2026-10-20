"use client";

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** The little eye that shows or hides what has been typed. Drawn inline so the shared package needs no icon library. */
export function EyeIcon({ open, size = 18 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/**
 * A password or PIN box with a "show" button, so people can check what they typed (small screens and shaky thumbs
 * make typos easy). Drop-in for <input type="password">: every normal input prop works, and className styles the
 * box itself. The type is managed here, so do not pass one.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(({ className, ...props }, ref) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative w-full">
      <input ref={ref} {...props} type={shown ? "text" : "password"} className={cn(className, "pr-11")} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide" : "Show"}
        aria-pressed={shown}
        title={shown ? "Hide" : "Show"}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-secondary-500 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <EyeIcon open={shown} />
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
