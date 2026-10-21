"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";

/**
 * A shopper's phone camera as a barcode reader: point it at a product (in the shop, at home) and the shop's matching item is
 * found. Keeps running so several items can be scanned one after another; the caller gets every decoded value and decides
 * what it means (and ignores the repeats a camera produces while a code stays in view).
 */
export default function ShopScanner({ onDetected, onClose, statusMessage }: { onDetected: (value: string) => void; onClose: () => void; statusMessage?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;
    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (!cancelled && result) onDetected(result.getText());
      })
      .then((controls) => {
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      })
      .catch((err) => {
        if (!cancelled) {
          setProblem(
            err instanceof Error && err.name === "NotAllowedError"
              ? "The camera is blocked. Allow it for this site in your browser settings, or search by name."
              : "Could not start the camera. Search by name instead.",
          );
        }
      });
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4" role="dialog" aria-label="Scan a barcode">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-surface">
        <div className="flex items-center justify-between border-b border-border p-3">
          <p className="font-semibold">Scan a barcode</p>
          <button onClick={onClose} className="px-2 text-secondary-500 hover:text-foreground">
            Done
          </button>
        </div>
        {problem ? (
          <div className="p-6 text-center text-sm text-secondary-600">{problem}</div>
        ) : (
          <>
            <video ref={videoRef} className="aspect-square w-full bg-black object-cover" muted playsInline />
            <div className="min-h-[3rem] p-3 text-center text-sm text-secondary-600">{statusMessage ?? "Point the camera at a product's barcode"}</div>
          </>
        )}
      </div>
    </div>
  );
}
