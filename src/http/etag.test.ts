import type { FastifyRequest } from 'fastify';
import { expect, it } from 'vitest';
import { notModified } from './etag.ts';

const ETAG = '"abc"';
const requestWith = (ifNoneMatch?: string) =>
  ({
    headers: ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch },
  }) as FastifyRequest;

it.each([
  ['the same tag', '"abc"', true],
  ['the weak form of the tag', 'W/"abc"', true],
  ['any tag', '*', true],
  ['a list holding the tag', '"x", W/"abc"', true],
  ['a different tag', '"x"', false],
  ['no header', undefined, false],
])('If-None-Match with %s (%s): not modified is %s', (_, header, expected) => {
  expect(notModified(requestWith(header), ETAG)).toBe(expected);
});
