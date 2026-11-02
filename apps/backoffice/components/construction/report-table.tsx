"use client";

export type ColType = "text" | "money" | "number" | "percent" | "date";
export type Row = Record<string, string | number | null>;
export interface ConReport { key: string; title: string; subtitle: string; columns: { key: string; label: string; type?: ColType }[]; rows: Row[]; totals?: Row; notes?: string[] }

const cell = (v: string | number | null | undefined, type?: ColType) => {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v !== "number") return v;
  if (type === "money") return v.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === "percent") return `${v.toLocaleString("en-KE", { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString("en-KE", { maximumFractionDigits: 2 });
};
const RIGHT = new Set<ColType | undefined>(["money", "number", "percent"]);

/** A report table: scrolls sideways on a phone, totals in bold, negative money in red. */
export function ReportTable({ report, print = false }: { report: ConReport; print?: boolean }) {
  const td = (r: Row, c: ConReport["columns"][number]) => (
    <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 ${RIGHT.has(c.type) ? "text-right tabular-nums" : ""}`} style={typeof r[c.key] === "number" && (r[c.key] as number) < 0 && c.type === "money" ? { color: "#b91c1c" } : undefined}>
      {cell(r[c.key], c.type)}
    </td>
  );
  return (
    <div className={print ? "" : "overflow-x-auto"}>
      {report.rows.length === 0 ? (
        <p className="py-4 text-sm text-secondary-500">Nothing to show for this choice yet.</p>
      ) : (
        <table className={`w-full border-collapse ${print ? "text-[10px]" : "text-xs sm:text-sm"}`}>
          <thead>
            <tr className="text-left text-white" style={{ background: "#1a2e5a" }}>
              {report.columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-2 py-2 font-semibold ${RIGHT.has(c.type) ? "text-right" : ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i} className="border-b border-border">{report.columns.map((c) => td(r, c))}</tr>
            ))}
            {report.totals && <tr className="border-t-2 font-bold" style={{ borderColor: "#d4af37" }}>{report.columns.map((c) => td(report.totals!, c))}</tr>}
          </tbody>
        </table>
      )}
      {report.notes?.map((n) => <p key={n} className="mt-2 text-xs text-secondary-500">{n}</p>)}
    </div>
  );
}
