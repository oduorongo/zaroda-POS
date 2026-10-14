import { BottomRibbon } from "./Ribbons";

/** Shared footnote mounted once per app root layout - shows on every page without touching every screen individually. Now the same sticky navy bottom ribbon as Zaroda Events. */
export function PoweredByFooter({ className }: { className?: string }) {
  return <BottomRibbon className={className} />;
}
