import type jsPDF from "jspdf";

/** "Powered by ZARODA SOLUTIONS" at the foot of every page of a PDF the free tools make. */
export function addPoweredBy(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const { width, height } = doc.internal.pageSize;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text("Powered by ZARODA SOLUTIONS", width / 2, height - 4, { align: "center" });
  }
}
