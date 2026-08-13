"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import jsPDF from "jspdf";
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
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReceiptClient() {
  const [businessName, setBusinessName] = useState("Your Shop Name");
  const [location, setLocation] = useState("Nairobi, Kenya");
  const [phone, setPhone] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("R-0001");
  const [taxPct, setTaxPct] = useState("16");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);

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
    const doc = new jsPDF({ unit: "mm", format: [80, 150 + items.length * 6] });
    const width = 80;
    let y = 8;

    doc.setFontSize(11);
    doc.setFont("courier", "bold");
    doc.text(businessName || "Your Shop Name", width / 2, y, { align: "center" });
    y += 5;

    doc.setFontSize(8);
    doc.setFont("courier", "normal");
    if (location) {
      doc.text(location, width / 2, y, { align: "center" });
      y += 4;
    }
    if (phone) {
      doc.text(phone, width / 2, y, { align: "center" });
      y += 4;
    }

    y += 2;
    doc.text("-".repeat(46), width / 2, y, { align: "center" });
    y += 4;
    doc.text(`Receipt: ${receiptNumber || "-"}`, 4, y);
    y += 4;
    doc.text(`Date: ${new Date().toLocaleString("en-KE")}`, 4, y);
    y += 4;
    doc.text("-".repeat(46), width / 2, y, { align: "center" });
    y += 4;

    items.forEach((item) => {
      const qty = parseFloat(item.qty) || 0;
      const price = parseFloat(item.price) || 0;
      doc.text(item.description || "-", 4, y);
      y += 4;
      doc.text(`${qty} x ${formatKes(price)}`, 4, y);
      doc.text(formatKes(qty * price), 76, y, { align: "right" });
      y += 4;
    });

    doc.text("-".repeat(46), width / 2, y, { align: "center" });
    y += 4;
    doc.text("Subtotal", 4, y);
    doc.text(formatKes(totals.subtotal), 76, y, { align: "right" });
    y += 4;
    doc.text(`Tax (${taxPct || 0}%)`, 4, y);
    doc.text(formatKes(totals.tax), 76, y, { align: "right" });
    y += 4;
    doc.setFont("courier", "bold");
    doc.text("TOTAL (KES)", 4, y);
    doc.text(formatKes(totals.total), 76, y, { align: "right" });
    y += 5;
    doc.setFont("courier", "normal");
    doc.text(`Paid via: ${paymentMethod}`, 4, y);
    y += 6;

    doc.setFontSize(8);
    doc.text("Thank you for shopping with us!", width / 2, y, { align: "center" });

    doc.save(`${receiptNumber || "receipt"}.pdf`);
  }

  function printReceipt() {
    window.print();
  }

  return (
    <main>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Receipt Generator</h1>
        <p className="mt-2 text-secondary-500">Build a thermal-style receipt in KES — print it or export as a PDF.</p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_260px]">
          <Card className="print:hidden">
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="businessName">Shop name</Label>
                  <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="receiptNumber">Receipt number</Label>
                  <Input id="receiptNumber" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xx xxx xxx" />
                </div>
                <div>
                  <Label htmlFor="taxPct">Tax (%)</Label>
                  <Input id="taxPct" type="number" min="0" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="paymentMethod">Payment method</Label>
                  <select
                    id="paymentMethod"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground"
                  >
                    <option>Cash</option>
                    <option>M-Pesa</option>
                    <option>Card</option>
                  </select>
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
                        value={item.price}
                        onChange={(e) => updateItem(item.id, { price: e.target.value })}
                        placeholder="Price"
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

              <div className="mt-6 flex gap-3">
                <Button onClick={downloadPdf} className="flex-1" size="lg">
                  Download PDF
                </Button>
                <Button onClick={printReceipt} variant="outline" className="flex-1" size="lg">
                  Print
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="print:mx-auto">
            <div className="mx-auto w-full max-w-[260px] rounded-md border border-border bg-white p-4 font-mono text-xs text-secondary-900 shadow-sm">
              <p className="text-center font-bold">{businessName || "Your Shop Name"}</p>
              {location && <p className="text-center">{location}</p>}
              {phone && <p className="text-center">{phone}</p>}
              <p className="my-2 border-t border-dashed border-secondary-300" />
              <p>Receipt: {receiptNumber || "-"}</p>
              <p>{new Date().toLocaleString("en-KE")}</p>
              <p className="my-2 border-t border-dashed border-secondary-300" />
              {items.map((item) => {
                const qty = parseFloat(item.qty) || 0;
                const price = parseFloat(item.price) || 0;
                return (
                  <div key={item.id} className="mb-1">
                    <p>{item.description || "-"}</p>
                    <div className="flex justify-between">
                      <span>
                        {qty} x {formatKes(price)}
                      </span>
                      <span>{formatKes(qty * price)}</span>
                    </div>
                  </div>
                );
              })}
              <p className="my-2 border-t border-dashed border-secondary-300" />
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatKes(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax ({taxPct || 0}%)</span>
                <span>{formatKes(totals.tax)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-secondary-900 pt-1 font-bold">
                <span>TOTAL (KES)</span>
                <span>{formatKes(totals.total)}</span>
              </div>
              <p className="mt-2">Paid via: {paymentMethod}</p>
              <p className="mt-3 text-center">Thank you for shopping with us!</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
