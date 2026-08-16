"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, LayoutGrid } from "lucide-react";

/**
 * Slim in-page navigation bar shown below the main Nav on every content
 * screen. "Home" always means the dashboard tile grid, never the public
 * marketing site (see components/nav.tsx for that separate, clearly-labeled
 * link) - a logged-in manager should land on their own screens, not be
 * thrown out of the app.
 */
export function PageHeader({ title }: { title?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5 sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        {!isDashboard && (
          <button
            type="button"
            onClick={() => router.back()}
            className="flex shrink-0 items-center gap-1.5 text-sm text-secondary-500 hover:text-foreground"
          >
            <ArrowLeft size={15} />
            Back
          </button>
        )}
        {title && <span className="truncate text-sm font-medium text-secondary-600">{title}</span>}
      </div>
      {!isDashboard && (
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="flex shrink-0 items-center gap-1.5 text-sm text-secondary-500 hover:text-foreground"
        >
          <LayoutGrid size={15} />
          Home
        </button>
      )}
    </div>
  );
}
