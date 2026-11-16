"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";

export interface CredentialsCardProps {
  title: string;
  loginUrl: string;
  email: string;
  password: string;
  /** Opening line of the shared message, e.g. "Your ZARODA Team sign-in". */
  shareHeading?: string;
  children?: ReactNode;
  onDone?: () => void;
  doneLabel?: string;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Sign-in details shown once: link, email and temporary password, each copyable, plus copy-all and share. */
export function CredentialsCard({ title, loginUrl, email, password, shareHeading = "Your ZARODA sign-in", children, onDone, doneLabel = "I have passed it on" }: CredentialsCardProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const message = `${shareHeading}\n\nSign in at: ${loginUrl}\nEmail: ${email}\nTemporary password: ${password}\n\nYou will be asked to choose your own password when you first sign in.`;

  async function copy(key: string, text: string) {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    }
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareHeading, text: message });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  const rows: [string, string, string, boolean][] = [
    ["link", "Sign-in link", loginUrl, false],
    ["email", "Email", email, false],
    ["password", "Temporary password", password, true],
  ];

  return (
    <div className="rounded-lg border border-warning-600/40 bg-warning-50 p-4 text-sm">
      <p className="font-semibold">{title}</p>
      <dl className="mt-3 space-y-2">
        {rows.map(([key, label, value, mono]) => (
          <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <div className="min-w-0">
              <dt className="text-xs text-secondary-500">{label}</dt>
              <dd className={`break-all font-semibold ${mono ? "font-mono text-base" : ""}`}>{value}</dd>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => copy(key, value)}>
              {copied === key ? "Copied" : "Copy"}
            </Button>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => copy("all", message)}>
          {copied === "all" ? "Copied" : "Copy all"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={share}>
          Share
        </Button>
      </div>
      {children}
      {onDone && (
        <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={onDone}>
          {doneLabel}
        </Button>
      )}
    </div>
  );
}
