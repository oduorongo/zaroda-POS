/**
 * Hands a CSV the server has already built (with spreadsheet formulas defused) to the browser as a file. A byte-order mark is put in
 * front so Excel opens guest names with accents correctly.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
