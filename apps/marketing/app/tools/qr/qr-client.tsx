"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Card, CardContent, Button, Input, Label } from "@zaroda/ui";

type Mode = "text" | "wifi";
type Encryption = "WPA" | "WEP" | "nopass";

function escapeWifiField(value: string) {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

function buildWifiString(ssid: string, password: string, encryption: Encryption, hidden: boolean) {
  const parts = [
    `WIFI:T:${encryption}`,
    `S:${escapeWifiField(ssid)}`,
    encryption === "nopass" ? "" : `P:${escapeWifiField(password)}`,
    hidden ? "H:true" : "",
  ].filter(Boolean);
  return parts.join(";") + ";;";
}

export default function QrClient() {
  const searchParams = useSearchParams();
  const initialMode: Mode = searchParams.get("mode") === "wifi" ? "wifi" : "text";
  const [mode, setMode] = useState<Mode>(initialMode);

  const [text, setText] = useState("https://zarodashop.com");

  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState<Encryption>("WPA");
  const [hidden, setHidden] = useState(false);

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const payload = mode === "text" ? text : buildWifiString(ssid, password, encryption, hidden);
  const canGenerate = mode === "text" ? text.trim().length > 0 : ssid.trim().length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canGenerate) {
      setDataUrl(null);
      return;
    }
    QRCode.toCanvas(canvas, payload, { width: 260, margin: 2 })
      .then(() => {
        setDataUrl(canvas.toDataURL("image/png"));
        setError(null);
      })
      .catch(() => setError("Couldn't generate a QR code for that input."));
  }, [payload, canGenerate]);

  function downloadPng() {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.download = mode === "wifi" ? `wifi-${ssid || "network"}.png` : "qr-code.png";
    link.href = dataUrl;
    link.click();
  }

  return (
    <main>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground">QR Code Generator</h1>
        <p className="mt-2 text-secondary-500">Generate a QR code for a link or a WiFi network.</p>

        <div className="mt-6 inline-flex rounded-md border border-border p-1">
          {(["text", "wifi"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-4 py-1.5 text-sm font-medium ${
                mode === m ? "bg-primary-600 text-white" : "text-secondary-600 hover:text-foreground"
              }`}
            >
              {m === "text" ? "Text / Link" : "WiFi"}
            </button>
          ))}
        </div>

        <Card className="mt-6">
          <CardContent>
            {mode === "text" ? (
              <div>
                <Label htmlFor="text">Text or URL</Label>
                <Input id="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="https://example.com" />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="ssid">Network name (SSID)</Label>
                  <Input id="ssid" value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="Shop WiFi" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="encryption">Encryption</Label>
                    <select
                      id="encryption"
                      value={encryption}
                      onChange={(e) => setEncryption(e.target.value as Encryption)}
                      className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground"
                    >
                      <option value="WPA">WPA/WPA2</option>
                      <option value="WEP">WEP</option>
                      <option value="nopass">No password</option>
                    </select>
                  </div>
                  {encryption !== "nopass" && (
                    <div>
                      <Label htmlFor="password">Password</Label>
                      <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm text-secondary-600">
                  <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="h-4 w-4 rounded border-border" />
                  Hidden network
                </label>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-error-600">{error}</p>}

            <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-6">
              <canvas ref={canvasRef} className={canGenerate ? "" : "hidden"} />
              {!canGenerate && (
                <p className="py-14 text-sm text-secondary-400">
                  {mode === "text" ? "Enter text or a URL to preview." : "Enter a network name to preview."}
                </p>
              )}
            </div>

            <Button onClick={downloadPng} disabled={!dataUrl} className="mt-6 w-full" size="lg">
              Download PNG
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
