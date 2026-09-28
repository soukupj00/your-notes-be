import type { Link, Links } from './contract/index.ts';

export function link(href: string, extra: Omit<Link, 'href'> = {}): Link {
  return { href, ...extra };
}

/** `{ ...body, _links, _embedded? }`, omitting `_embedded` when there is nothing to embed. */
export function hal<T extends object, L extends Links>(body: T, links: L): T & { _links: L };
export function hal<T extends object, L extends Links, E extends Record<string, unknown>>(
  body: T,
  links: L,
  embedded: E
): T & { _links: L; _embedded: E };
export function hal<T extends object, L extends Links, E extends Record<string, unknown>>(
  body: T,
  links: L,
  embedded?: E
): T & { _links: L; _embedded?: E } {
  return embedded ? { ...body, _links: links, _embedded: embedded } : { ...body, _links: links };
}
