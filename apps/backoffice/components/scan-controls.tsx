"use client";

import { useState } from "react";
import { BarcodeScanner } from "./barcode-scanner";
import { useScanner } from "../hooks/use-scanner";

/**
 * The scanning part of a product picker: a camera button, the note about what the last scan found, and the scanner-gun
 * listener (a gun works with no box selected). `onCode` gets the scanned code and says whether it found a product - the camera
 * closes when it did. `enabled` lets a screen with two pickers say which one a scan is for.
 */
export function ScanControls({ onCode, enabled = true, note }: { onCode: (code: string) => boolean; enabled?: boolean; note?: string | null }) {
  const [open, setOpen] = useState(false);
  useScanner((code) => void onCode(code), enabled && !open);

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-secondary-500">
        <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-2 py-1 hover:bg-surface">
          Scan with the camera
        </button>
        <span>or use a scanner gun.</span>
      </div>
      {note && <p className="mt-1 text-sm text-amber-500">{note}</p>}
      {open && (
        <BarcodeScanner
          onDetected={(code) => {
            if (onCode(code)) setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
