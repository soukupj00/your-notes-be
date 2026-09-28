import { expect, it } from 'vitest';
import { hal, link } from './hal.ts';

it('adds _links, and _embedded only when given', () => {
  expect(hal({ a: 1 }, { self: link('/x') })).toEqual({ a: 1, _links: { self: { href: '/x' } } });
  expect(hal({}, { self: link('/x', { title: 'X' }) }, { items: [] })).toEqual({
    _links: { self: { href: '/x', title: 'X' } },
    _embedded: { items: [] },
  });
});
