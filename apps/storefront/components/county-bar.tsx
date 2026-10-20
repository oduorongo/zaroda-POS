"use client";

import { KENYA_COUNTIES } from "@zaroda/ui";
import { MapPin } from "lucide-react";
import { useMyCounty } from "../lib/my-county";

/** "Where are you?" - shops that deliver to your county are marked, so nobody orders food from the other end of the country. */
export default function CountyBar() {
  const [county, setCounty] = useMyCounty();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
      <MapPin size={18} className="text-primary-600" aria-hidden />
      <label htmlFor="my-county" className="text-sm font-medium">
        Which county are you in?
      </label>
      <select id="my-county" value={county} onChange={(e) => setCounty(e.target.value)} className="rounded-md border border-border bg-surface p-2 text-sm">
        <option value="">Choose your county</option>
        {KENYA_COUNTIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="text-xs text-secondary-500">{county ? `Shops that deliver to ${county} are marked.` : "We will mark the shops that can deliver to you."}</span>
    </div>
  );
}
