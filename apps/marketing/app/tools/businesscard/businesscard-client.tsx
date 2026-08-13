"use client";

import { useState } from "react";
import Link from "next/link";
import jsPDF from "jspdf";
import { Card, CardContent, Button, Input, Label } from "@zaroda/ui";

const CARD_W = 350;
const CARD_H = 200;

function drawCard(
  ctx: CanvasRenderingContext2D,
  data: { name: string; title: string; business: string; phone: string; email: string }
) {
  ctx.clearRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.fillStyle = "#2563eb";
  ctx.fillRect(0, 0, 8, CARD_H);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px Arial";
  ctx.fillText(data.name || "Your Name", 28, 60);

  ctx.fillStyle = "#93c5fd";
  ctx.font = "13px Arial";
  ctx.fillText(data.title || "Job Title", 28, 82);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "12px Arial";
  ctx.fillText(data.business || "Business Name", 28, 130);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Arial";
  if (data.phone) ctx.fillText(data.phone, 28, 155);
  if (data.email) ctx.fillText(data.email, 28, 172);

  ctx.fillStyle = "#2563eb";
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "right";
  ctx.fillText("Zaroda", CARD_W - 20, CARD_H - 20);
  ctx.textAlign = "left";
}

export default function BusinessCardClient() {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [business, setBusiness] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  function renderToCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawCard(ctx, { name, title, business, phone, email });
    return canvas;
  }

  function downloadPng() {
    const canvas = renderToCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${name || "business-card"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function downloadPdf() {
    const canvas = renderToCanvas();
    if (!canvas) return;
    const doc = new jsPDF({ unit: "mm", format: [89, 51], orientation: "landscape" });
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 89, 51);
    doc.save(`${name || "business-card"}.pdf`);
  }

  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Business Card Generator</h1>
        <p className="mt-2 text-secondary-500">Fill in your details and download a simple business card.</p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Wanjiru" />
                </div>
                <div>
                  <Label htmlFor="title">Job title</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Owner" />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="business">Business name</Label>
                  <Input id="business" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="Mama Njeri's Minimart" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <Button onClick={downloadPng} className="flex-1" size="lg">
                  Download PNG
                </Button>
                <Button onClick={downloadPdf} variant="outline" className="flex-1" size="lg">
                  Download PDF
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start justify-center">
            <div
              className="w-full max-w-[350px] rounded-lg p-7 shadow-md"
              style={{ aspectRatio: "350 / 200", background: "#0f172a", borderLeft: "8px solid #2563eb" }}
            >
              <p className="text-lg font-bold text-white">{name || "Your Name"}</p>
              <p className="mt-1 text-sm text-primary-300">{title || "Job Title"}</p>
              <p className="mt-6 text-sm text-secondary-200">{business || "Business Name"}</p>
              <p className="mt-3 text-xs text-secondary-400">{phone}</p>
              <p className="text-xs text-secondary-400">{email}</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
