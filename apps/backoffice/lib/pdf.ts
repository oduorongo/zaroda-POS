import type { jsPDF } from "jspdf";
import { apiGet } from "./api";
import { getSession } from "./auth";

const NAVY: [number, number, number] = [15, 31, 69];
const GOLD: [number, number, number] = [212, 175, 55];

export type Cell = string | number | null | undefined;
export interface PdfColumn { label: string; money?: boolean; number?: boolean }
export interface PdfTable { heading?: string; columns: PdfColumn[]; rows: Cell[][]; totals?: Cell[]; noHead?: boolean }
export interface PdfDocument {
  title: string;
  subtitle?: string;
  /** Short label/value lines under the title (e.g. a buyer's balance). */
  summary?: [string, string][];
  tables: PdfTable[];
  notes?: string[];
}

/** A report in the shared report format (farm and construction reports). */
export interface ReportLike {
  title: string;
  subtitle: string;
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
  notes?: string[];
}

let identity: { token: string; value: Promise<{ company: string; user: string }> } | null = null;

/** Who the document is for and who prepared it: the farm's name for a farm, else the business name; the signed-in user's name. */
export function pdfIdentity() {
  const token = getSession()?.accessToken ?? "";
  if (identity?.token === token) return identity.value;
  const value = (async () => {
    const session = getSession();
    const org = await apiGet<{ name: string; me?: { fullName: string | null } }>("/organizations/me").catch(() => null);
    let company = org?.name ?? session?.orgName ?? "";
    if (session?.industryType === "FARM") {
      const farm = await apiGet<{ settings?: { farmName?: string | null } }>("/farm/overview").catch(() => null);
      company = farm?.settings?.farmName || company;
    }
    return { company, user: org?.me?.fullName || session?.email || "" };
  })();
  identity = { token, value };
  return value;
}

const fmt = (v: Cell, c: PdfColumn) => {
  if (v == null || v === "") return "";
  if (typeof v === "number") return c.money ? v.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toLocaleString("en-KE");
  return String(v);
};

export function fromReport(r: ReportLike): PdfDocument {
  const columns = r.columns.map((c) => ({ label: c.label, money: c.type === "money", number: c.type === "number" || c.type === "percent" }));
  return {
    title: r.title,
    subtitle: r.subtitle,
    tables: [{ columns, rows: r.rows.map((row) => r.columns.map((c) => row[c.key])), totals: r.totals ? r.columns.map((c) => r.totals![c.key]) : undefined }],
    notes: r.notes,
  };
}

export async function makePdf(d: PdfDocument): Promise<jsPDF> {
  const [{ jsPDF }, { default: autoTable }, who] = await Promise.all([import("jspdf"), import("jspdf-autotable"), pdfIdentity()]);
  const wide = Math.max(0, ...d.tables.map((t) => t.columns.length)) > 6;
  const doc = new jsPDF({ orientation: wide ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const printed = new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });

  doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(16).text(who.company || "ZARODA", M, 16);
  doc.setDrawColor(...GOLD).setLineWidth(0.8).line(M, 19, W - M, 19);
  doc.setFontSize(13).text(d.title, M, 27);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  let y = 32;
  if (d.subtitle) {
    doc.text(d.subtitle, M, y);
    y += 5;
  }
  doc.text(`Prepared by ${who.user || "-"} on ${printed}`, M, y);
  y += 6;
  for (const [k, v] of d.summary ?? []) {
    doc.setTextColor(...NAVY).setFont("helvetica", "bold").text(`${k}:`, M, y);
    doc.setFont("helvetica", "normal").text(v, M + 45, y);
    y += 5;
  }

  for (const t of d.tables) {
    if (t.heading) {
      doc.setTextColor(...NAVY).setFont("helvetica", "bold").setFontSize(11).text(t.heading, M, y + 4);
      y += 6;
    }
    const right = t.columns.map((c) => c.money || c.number);
    autoTable(doc, {
      startY: y + 2,
      margin: { left: M, right: M, top: 16, bottom: 14 },
      head: [t.columns.map((c) => c.label)],
      showHead: t.noHead ? "never" : "everyPage",
      body: t.rows.map((r) => t.columns.map((c, i) => fmt(r[i], c))),
      foot: t.totals ? [t.columns.map((c, i) => fmt(t.totals![i], c))] : undefined,
      showFoot: "lastPage",
      styles: { fontSize: 8, cellPadding: 1.6, textColor: 30 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: [243, 244, 248], textColor: NAVY, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [249, 250, 252] },
      columnStyles: Object.fromEntries(right.map((r, i) => [i, { halign: r ? "right" : "left" }]).filter(([, s]) => (s as { halign: string }).halign === "right")),
      didParseCell: (h) => {
        if ((h.section === "head" || h.section === "foot") && right[h.column.index]) h.cell.styles.halign = "right";
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (d.notes?.length) {
    doc.setFont("helvetica", "italic").setFontSize(8).setTextColor(90);
    for (const n of d.notes) {
      const lines = doc.splitTextToSize(n, W - 2 * M);
      if (y + lines.length * 4 > doc.internal.pageSize.getHeight() - 14) {
        doc.addPage();
        y = 16;
      }
      doc.text(lines, M, y);
      y += lines.length * 4 + 1;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(130);
    doc.text(`${who.company} - ${d.title}`, M, H - 7);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 7, { align: "right" });
  }
  return doc;
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");

export async function downloadPdf(d: PdfDocument, filename: string) {
  (await makePdf(d)).save(safe(filename.endsWith(".pdf") ? filename : `${filename}.pdf`));
}

/** Opens the PDF in a new tab with the print dialog. */
export async function printPdf(d: PdfDocument) {
  const doc = await makePdf(d);
  doc.autoPrint();
  const url = URL.createObjectURL(doc.output("blob"));
  const win = window.open(url, "_blank");
  if (!win) doc.save(safe(`${d.title}.pdf`));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * A CSV-style sheet (as the books reports build for their CSV download) as a PDF: the first row is the title and its
 * period, blank rows split tables, and a table's first row is its header when it is all words.
 */
export function fromRows(sheet: (string | number)[][]): PdfDocument {
  const [head = [], ...rest] = sheet;
  const segments: (string | number)[][][] = [[]];
  for (const r of rest) {
    if (r.length === 0 || r.every((c) => c === "")) {
      if (segments[segments.length - 1].length) segments.push([]);
    } else segments[segments.length - 1].push(r);
  }
  const tables: PdfTable[] = segments
    .filter((s) => s.length)
    .map((seg) => {
      const width = Math.max(...seg.map((r) => r.length));
      const isHeader = seg[0].every((c) => typeof c === "string" && c !== "");
      const body = (isHeader ? seg.slice(1) : seg).map((r) => [...r, ...Array(width - r.length).fill("")]);
      const numeric = Array.from({ length: width }, (_, i) => body.some((r) => typeof r[i] === "number"));
      const label = (i: number) => (isHeader ? String(seg[0][i] ?? "") : "");
      // Amounts in the books are money; a count such as days late is not.
      const counted = (i: number) => /day|no\.|count|number/i.test(label(i));
      return {
        columns: Array.from({ length: width }, (_, i) => ({ label: label(i), money: numeric[i] && !counted(i), number: numeric[i] && counted(i) })),
        rows: body,
        noHead: !isHeader,
      };
    });
  return { title: String(head[0] ?? ""), subtitle: head.slice(1).filter((c) => c !== "").join(" · "), tables };
}
