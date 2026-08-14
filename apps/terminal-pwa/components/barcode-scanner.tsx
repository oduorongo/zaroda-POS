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
 * Camera-based 1D barcode + QR scanner for shops using a tablet with no
 * scanner gun. Wraps @zxing/browser's continuous video decode loop - the
 * decode callback fires on every frame (with a NotFoundException while no
 * code is in view, which is normal and not surfaced as an error), so the
 * caller is responsible for deciding what a decoded value means and for
 * calling onClose() once it's done with the camera.
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
            ? "Camera permission denied - use search instead. · Idhini ya kamera imekataliwa"
            : "Could not start the camera - use search instead.",
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
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-secondary-900">
        <div className="flex items-center justify-between border-b border-secondary-800 p-3">
          <p className="font-semibold text-secondary-100">Scan · Skani</p>
          <button onClick={onClose} className="min-h-touch px-2 text-secondary-400 hover:text-secondary-100">
            Close
          </button>
        </div>

        {permissionError ? (
          <div className="p-6 text-center text-sm text-secondary-300">{permissionError}</div>
        ) : (
          <>
            <video ref={videoRef} className="aspect-square w-full bg-black object-cover" muted playsInline />
            <div className="min-h-[2.5rem] p-3 text-center text-sm text-secondary-400">
              {statusMessage ?? "Point the camera at a barcode or QR code"}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
