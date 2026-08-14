"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Card, CardContent, Button, Input, Label } from "@zaroda/ui";

type LineItem = {
  id: number;
  description: string;
  qty: string;
  price: string;
};

let nextId = 1;

function emptyItem(): LineItem {
  return { id: nextId++, description: "", qty: "1", price: "0" };
}

function formatKes(value: number) {
  if (!Number.isFinite(value)) return "KES 0.00";
  return `KES ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function InvoiceClient() {
  const [businessName, setBusinessName] = useState("Your Business Name");
  const [clientName, setClientName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("INV-0001");
  const [taxPct, setTaxPct] = useState("16");
  const [notes, setNotes] = useState("Thank you for your business.");
  const [items, setItems] = useState<LineItem[]>([emptyItem(), emptyItem()]);

  const logoInitials = businessName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "ZB";

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => {
      const qty = parseFloat(item.qty) || 0;
      const price = parseFloat(item.price) || 0;
      return sum + qty * price;
    }, 0);
    const tax = subtotal * ((parseFloat(taxPct) || 0) / 100);
    return { subtotal, tax, total: subtotal + tax };
  }, [items, taxPct]);

  function updateItem(id: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(id: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  }

  function downloadPdf() {
    const doc = new jsPDF();

    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(logoInitials, 14, 18);
    doc.setFontSize(18);
    doc.setTextColor(20);
    doc.text(businessName || "Your Business Name", 14, 28);

    doc.setFontSize(11);
    doc.setTextColor(80);
    doc.text(`Invoice: ${invoiceNumber || "-"}`, 196, 18, { align: "right" });
    doc.text(`Date: ${new Date().toLocaleDateString("en-KE")}`, 196, 24, { align: "right" });
    if (clientName) doc.text(`Bill to: ${clientName}`, 196, 30, { align: "right" });

    autoTable(doc, {
      startY: 40,
      head: [["Description", "Qty", "Unit price (KES)", "Line total (KES)"]],
      body: items.map((item) => {
        const qty = parseFloat(item.qty) || 0;
        const price = parseFloat(item.price) || 0;
        return [
          item.description || "-",
          qty.toString(),
          price.toLocaleString("en-KE", { minimumFractionDigits: 2 }),
          (qty * price).toLocaleString("en-KE", { minimumFractionDigits: 2 }),
        ];
      }),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [37, 99, 235] },
    });

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

    doc.setFontSize(11);
    doc.text(`Subtotal: ${formatKes(totals.subtotal)}`, 196, finalY, { align: "right" });
    doc.text(`Tax (${taxPct || 0}%): ${formatKes(totals.tax)}`, 196, finalY + 6, { align: "right" });
    doc.setFontSize(13);
    doc.text(`Total: ${formatKes(totals.total)}`, 196, finalY + 14, { align: "right" });

    if (notes) {
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(notes, 14, finalY + 24, { maxWidth: 180 });
    }

    doc.save(`${invoiceNumber || "invoice"}.pdf`);
  }

  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Invoice Generator</h1>
        <p className="mt-2 text-secondary-500">Build a line-item invoice in KES and export it as a PDF.</p>

        <Card className="mt-8">
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary-600 text-sm font-bold text-white">
                {logoInitials}
              </div>
              <p className="text-xs text-secondary-400">Your logo shows as initials on the invoice.</p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="businessName">Business name</Label>
                <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="invoiceNumber">Invoice number</Label>
                <Input id="invoiceNumber" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="clientName">Client name</Label>
                <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Mama Njeri's Minimart" />
              </div>
              <div>
                <Label htmlFor="taxPct">Tax (%)</Label>
                <Input id="taxPct" type="number" min="0" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
              </div>
            </div>

            <div className="mt-6">
              <Label>Line items</Label>
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="grid grid-cols-12 items-center gap-2">
                    <Input
                      className="col-span-6"
                      value={item.description}
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      placeholder="Item description"
                    />
                    <Input
                      className="col-span-2"
                      type="number"
                      min="0"
                      value={item.qty}
                      onChange={(e) => updateItem(item.id, { qty: e.target.value })}
                      placeholder="Qty"
                    />
                    <Input
                      className="col-span-3"
                      type="number"
                      min="0"
                      value={item.price}
                      onChange={(e) => updateItem(item.id, { price: e.target.value })}
                      placeholder="Price"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="col-span-1 flex h-10 items-center justify-center rounded-md text-secondary-400 hover:bg-secondary-50 hover:text-error-600"
                      aria-label="Remove line item"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addItem} className="mt-3">
                + Add line item
              </Button>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="mt-6 space-y-1 rounded-lg border border-border bg-surface p-4 text-right text-sm">
              <div className="text-secondary-500">Subtotal: {formatKes(totals.subtotal)}</div>
              <div className="text-secondary-500">Tax: {formatKes(totals.tax)}</div>
              <div className="text-lg font-semibold text-foreground">Total: {formatKes(totals.total)}</div>
            </div>

            <Button onClick={downloadPdf} size="lg" className="mt-6 w-full">
              Download PDF
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
