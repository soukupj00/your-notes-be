import type { Link, Links } from '../contract/index.ts';

export function link(href: string, extra: Omit<Link, 'href'> = {}): Link {
  return { href, ...extra };
}

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
