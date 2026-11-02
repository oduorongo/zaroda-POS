import { Fragment, type ReactNode } from "react";

// Just enough Markdown for the user guide: # and ## headings, paragraphs, "- " lists, | tables |, --- rules and **bold**.

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function GuideMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("## ")) {
      const t = line.slice(3);
      out.push(<h2 key={i} id={slug(t)} className="mt-8 scroll-mt-20 border-b border-border pb-1 text-xl font-bold" style={{ color: "var(--con-ink)" }}>{t}</h2>);
      i++;
    } else if (line.startsWith("# ")) {
      i++; // the page shows its own title
    } else if (line.trim() === "---") {
      out.push(<hr key={i} className="my-6 border-border" />);
      i++;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      out.push(<ul key={i} className="my-2 list-disc space-y-1 pl-5">{items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ul>);
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(cells(lines[i]));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={i} className="my-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary-500/10"><tr>{head.map((h, n) => <th key={n} className="p-2 font-semibold">{inline(h)}</th>)}</tr></thead>
            <tbody>{body.map((r, n) => <tr key={n} className="border-t border-border align-top">{r.map((c, m) => <td key={m} className="p-2">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#|- |\||---)/.test(lines[i])) para.push(lines[i++]);
      out.push(<p key={i} className="my-2">{inline(para.join(" "))}</p>);
    }
  }
  return <div className="text-sm leading-relaxed sm:text-base">{out}</div>;
}
