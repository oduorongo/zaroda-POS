"use client";

import { cn } from "../lib/cn";

export interface PinPadProps {
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  className?: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

// Touch-target-first numeric pad for cashier PIN login. Large hit areas (min 64px, well
// above the 44px floor) since this is the very first tap-under-pressure moment of a shift.
export function PinPad({ value, maxLength = 4, onChange, onSubmit, disabled, className }: PinPadProps) {
  const handleKey = (key: string) => {
    if (disabled) return;
    if (key === "clear") {
      onChange("");
      return;
    }
    if (key === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length >= maxLength) return;
    const next = value + key;
    onChange(next);
    if (next.length === maxLength) onSubmit?.();
  };

  return (
    <div className={cn("w-full max-w-xs", className)}>
      <div className="mb-6 flex justify-center gap-3" aria-hidden="true">
        {Array.from({ length: maxLength }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-4 w-4 rounded-full border-2 border-primary-600",
              i < value.length ? "bg-primary-600" : "bg-transparent"
            )}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => handleKey(key)}
            aria-label={key === "back" ? "Backspace" : key === "clear" ? "Clear" : key}
            className={cn(
              "h-16 rounded-lg text-xl font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              "disabled:opacity-50",
              key === "clear" || key === "back"
                ? "bg-secondary-100 text-secondary-600 hover:bg-secondary-200 text-sm"
                : "bg-surface border border-border text-foreground hover:bg-secondary-50"
            )}
          >
            {key === "back" ? "⌫" : key === "clear" ? "Clear" : key}
          </button>
        ))}
      </div>
    </div>
  );
}
