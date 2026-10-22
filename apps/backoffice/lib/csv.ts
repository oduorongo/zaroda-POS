// CSV for the catalog: the import template, and the export of the current catalog.

/**
 * One cell of a CSV file. A cell that starts with = + - or @ would be run as a formula by Excel or Sheets (a product named
 * "=HYPERLINK(...)" is an attack), so it gets an apostrophe in front; the import takes that apostrophe off again. Quotes,
 * commas and line breaks are handled the usual way.
 */
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Gives the browser a text file to save. The leading BOM makes Excel read accented letters properly. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The columns of the import file, in order. The export writes the same ones, so an export can be edited and imported again. */
export const CATALOG_COLUMNS = ["product_name", "category", "tax_class", "variant_name", "sku", "price", "cost", "barcode", "quantity_mode", "opening_stock"] as const;

export const TEMPLATE_ROWS: string[][] = [
  ["Bread", "Bakery", "VAT 16%", "Large loaf 800g", "BRD-L", "85", "60", "", "COUNT", "20"],
  ["Bread", "Bakery", "VAT 16%", "Small loaf 400g", "BRD-S", "50", "35", "", "COUNT", "30"],
  ["Sugar", "Groceries", "", "", "SUG-1", "190", "165", "6161100000011", "WEIGHT", "12.5"],
];
