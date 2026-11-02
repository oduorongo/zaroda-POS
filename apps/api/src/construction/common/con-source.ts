import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..');

export function conSourceFiles(dir = ROOT): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return conSourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

export interface Method { file: string; name: string; body: string }

/** Class methods of every construction source file (two-space indented `name(` ... `\n  }`). */
export function conMethods(): Method[] {
  const out: Method[] = [];
  for (const file of conSourceFiles()) {
    const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const re = /^ {2}(?:(?:private|public|protected|static|async|readonly) )*([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\(/gm;
    const starts = [...src.matchAll(re)].map((m) => ({ name: m[1], at: m.index! }));
    starts.forEach((s, i) => out.push({ file: relative(ROOT, file).replace(/\\/g, '/'), name: s.name, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
  }
  return out;
}
