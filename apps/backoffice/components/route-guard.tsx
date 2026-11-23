"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getSession, homePath } from "../lib/auth";
import { limitedTo } from "../lib/menu";

// Pages for people who are not signed in (or have their own sign-in): never held back, and rendered on the server as before.
const PUBLIC = [
  "/login", "/register", "/auth", "/team", "/book", "/guide",
  "/construction/welcome", "/construction/login", "/construction/signup", "/construction/pricing", "/construction/portal", "/construction/guide",
  "/rentals/welcome", "/rentals/login", "/rentals/signup", "/rentals/pricing", "/rentals/guide",
  "/shamba/welcome", "/shamba/login", "/shamba/signup", "/shamba/pricing", "/shamba/guide",
];
const under = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

/** Keeps supervisors, cashiers and caretakers on the screens their menu lists (lib/menu.ts); anywhere else sends them home. */
export default function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const open = pathname === "/" || under(pathname, PUBLIC);
  const [checked, setChecked] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    const s = getSession();
    const allowed = s ? limitedTo(s) : null;
    if (s && allowed && !under(pathname, allowed)) router.replace(homePath(s.role, s.industryType));
    else setChecked(pathname);
  }, [open, pathname, router]);

  return open || checked === pathname ? children : null;
}
