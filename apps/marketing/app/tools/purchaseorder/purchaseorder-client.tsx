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
  unitCost: string;
};

let nextId = 1;

function emptyItem(): LineItem {
  return { id: nextId++, description: "", qty: "1", unitCost: "0" };
}

function formatKes(value: number) {
  if (!Number.isFinite(value)) return "KES 0.00";
  return `KES ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PurchaseOrderClient() {
  const [businessName, setBusinessName] = useState("Your Business Name");
  const [supplierName, setSupplierName] = useState("");
  const [poNumber, setPoNumber] = useState("PO-0001");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([emptyItem(), emptyItem()]);

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const qty = parseFloat(item.qty) || 0;
        const cost = parseFloat(item.unitCost) || 0;
        return sum + qty * cost;
      }, 0),
    [items]
  );

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

    doc.setFontSize(18);
    doc.setTextColor(20);
    doc.text(businessName || "Your Business Name", 14, 20);

    doc.setFontSize(14);
    doc.setTextColor(80);
    doc.text("Purchase Order", 196, 20, { align: "right" });

    doc.setFontSize(10);
    doc.text(`PO Number: ${poNumber || "-"}`, 196, 28, { align: "right" });
    doc.text(`Date: ${new Date().toLocaleDateString("en-KE")}`, 196, 34, { align: "right" });
    if (deliveryDate) doc.text(`Delivery by: ${deliveryDate}`, 196, 40, { align: "right" });

    doc.setFontSize(11);
    doc.text(`Supplier: ${supplierName || "-"}`, 14, 40);

    autoTable(doc, {
      startY: 50,
      head: [["Description", "Qty", "Unit cost (KES)", "Line total (KES)"]],
      body: items.map((item) => {
        const qty = parseFloat(item.qty) || 0;
        const cost = parseFloat(item.unitCost) || 0;
        return [
          item.description || "-",
          qty.toString(),
          cost.toLocaleString("en-KE", { minimumFractionDigits: 2 }),
          (qty * cost).toLocaleString("en-KE", { minimumFractionDigits: 2 }),
        ];
      }),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [15, 23, 42] },
    });

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

    doc.setFontSize(13);
    doc.text(`Total: ${formatKes(total)}`, 196, finalY, { align: "right" });

    if (notes) {
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(notes, 14, finalY + 10, { maxWidth: 180 });
    }

    doc.save(`${poNumber || "purchase-order"}.pdf`);
  }

  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Purchase Order Generator</h1>
        <p className="mt-2 text-secondary-500">Build a supplier purchase order in KES and export it as a PDF.</p>

        <Card className="mt-8">
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="businessName">Your business name</Label>
                <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="poNumber">PO number</Label>
                <Input id="poNumber" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="supplierName">Supplier name</Label>
                <Input id="supplierName" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Kilimo Wholesalers Ltd" />
              </div>
              <div>
                <Label htmlFor="deliveryDate">Delivery by (optional)</Label>
                <Input id="deliveryDate" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
            </div>

            <div className="mt-6">
              <Label>Items</Label>
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
                      value={item.unitCost}
                      onChange={(e) => updateItem(item.id, { unitCost: e.target.value })}
                      placeholder="Unit cost"
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="col-span-1 flex h-10 items-center justify-center rounded-md text-secondary-400 hover:bg-secondary-50 hover:text-error-600"
                      aria-label="Remove item"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addItem} className="mt-3">
                + Add item
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

            <div className="mt-6 rounded-lg border border-border bg-surface p-4 text-right text-lg font-semibold text-foreground">
              Total: {formatKes(total)}
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
