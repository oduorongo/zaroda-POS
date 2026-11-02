/** Links for construction businesses always use CONSTRUCTION_DOMAIN, always https (.app domains are HTTPS-only). null when unset. */
export function constructionUrl(path: string, domain: string | undefined = process.env.CONSTRUCTION_DOMAIN): string | null {
  const host = domain?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return host ? `https://${host}${path.startsWith('/') ? path : `/${path}`}` : null;
}
