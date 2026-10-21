"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";

interface BarcodeScannerProps {
  /** Called on every decoded frame - the caller decides whether the value matches anything. */
  onDetected: (value: string) => void;
  onClose: () => void;
  /** Shown under the video feed, e.g. a "not found" message for the last scanned value. */
  statusMessage?: string | null;
}

/**
 * Camera barcode and QR scanner for a phone or tablet (no scanner gun needed). The decode callback fires on every frame
 * while a code is in view, so the caller decides what a value means and calls onClose() once it has what it needs. Same
 * component as the till's.
 */
export function BarcodeScanner({ onDetected, onClose, statusMessage }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (cancelled || !result) return;
        onDetected(result.getText());
      })
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      })
      .catch((err) => {
        if (cancelled) return;
        setPermissionError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "The camera is blocked. Allow it for this site in your browser, or type the code instead."
            : "Could not start the camera. Type the code instead.",
        );
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-surface">
        <div className="flex items-center justify-between border-b border-border p-3">
          <p className="font-semibold">Scan a barcode</p>
          <button onClick={onClose} className="px-2 text-secondary-500 hover:text-foreground">
            Close
          </button>
        </div>

        {permissionError ? (
          <div className="p-6 text-center text-sm text-secondary-600">{permissionError}</div>
        ) : (
          <>
            <video ref={videoRef} className="aspect-square w-full bg-black object-cover" muted playsInline />
            <div className="min-h-[2.5rem] p-3 text-center text-sm text-secondary-500">{statusMessage ?? "Point the camera at a barcode"}</div>
          </>
        )}
      </div>
    </div>
  );
}
