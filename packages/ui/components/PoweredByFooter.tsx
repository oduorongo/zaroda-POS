import { cn } from "../lib/cn";

/** Shared footnote mounted once per app root layout - shows on every page without touching every screen individually. */
export function PoweredByFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("border-t border-border bg-surface px-4 py-3 text-center text-xs text-secondary-500", className)}>
      Powered by Zaroda Solutions. Innovative. Reliable. Forward.
    </footer>
  );
}
