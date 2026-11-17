"use client";

import { KENYA_COUNTIES } from "@zaroda/ui";
import { LocateFixed, MapPin } from "lucide-react";
import { useMyCounty } from "../lib/my-county";
import { useMyLocation } from "../lib/my-location";

/** "Where are you?" - one tap shares the phone's location (shops listed nearest first); or choose a county. */
export default function CountyBar() {
  const [county, setCounty] = useMyCounty();
  const { spot, locating, error, locate, forget } = useMyLocation();
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        <MapPin size={18} className="text-primary-600" aria-hidden />
        <span className="text-sm font-medium">Where are you?</span>
        {spot ? (
          <span className="text-sm text-success-600">
            Using your location: nearest shops first.{" "}
            <button type="button" onClick={forget} className="text-secondary-500 underline">
              Stop
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void locate()}
            disabled={locating}
            className="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <LocateFixed size={15} aria-hidden /> {locating ? "Finding you..." : "Use my location"}
          </button>
        )}
        <label htmlFor="my-county" className="text-sm text-secondary-600">
          {spot ? "County" : "or county"}
        </label>
        <select id="my-county" value={county} onChange={(e) => setCounty(e.target.value)} className="rounded-md border border-border bg-surface p-2 text-sm">
          <option value="">Choose your county</option>
          {KENYA_COUNTIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-warning-700">{error}</p>}
      {!spot && !error && <p className="text-xs text-secondary-500">Your location is kept on your phone to show which shops are near. It is only sent to a shop with a delivery order, so it can check it reaches you.</p>}
    </div>
  );
}
