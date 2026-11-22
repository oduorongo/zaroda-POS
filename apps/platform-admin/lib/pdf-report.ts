import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const NAVY: [number, number, number] = [15, 31, 69];
const GOLD: [number, number, number] = [212, 175, 55];
const FOOTNOTE = "Powered by ZARODA SOLUTIONS - Innovative. Reliable. Forward. - WhatsApp 0781230805 - Call 0724282065";

/** One table row; `bold` rows are section titles and totals. Numbers are right-aligned in KES. */
export interface PdfRow {
  cells: (string | number)[];
  bold?: boolean;
}

const money = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Downloads a report as an A4 PDF: ZARODA heading, title and period, the table, and the ZARODA SOLUTIONS footnote
 * with page numbers on every page.
 */
export function downloadReportPdf(file: string, title: string, period: string, head: string[], rows: PdfRow[]): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, width, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ZARODA SOLUTIONS", 40, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("ZARODA's own books", 40, 48);
  doc.setFillColor(...GOLD);
  doc.rect(0, 64, width, 3, "F");

  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 40, 92);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(period, 40, 108);

  const numeric = head.map((h, i) => i > 0 && /debit|credit|amount|balance|kes/i.test(h));
  autoTable(doc, {
    startY: 122,
    head: [head],
    body: rows.map((r) => r.cells.map((c) => (typeof c === "number" ? money(c) : c))),
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 4, textColor: [30, 30, 30] },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255] },
    columnStyles: Object.fromEntries(numeric.map((n, i) => [i, n ? { halign: "right" } : {}]).filter(([, s]) => Object.keys(s as object).length)),
    didParseCell: (data) => {
      if (data.section === "body" && rows[data.row.index]?.bold) data.cell.styles.fontStyle = "bold";
    },
    margin: { left: 40, right: 40, bottom: 50 },
  });

  const pages = doc.getNumberOfPages();
  const printed = new Date().toLocaleString("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const h = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.text(FOOTNOTE, width / 2, h - 28, { align: "center" });
    doc.text(`Printed ${printed} - page ${p} of ${pages}`, width / 2, h - 16, { align: "center" });
  }
  doc.save(file);
}
