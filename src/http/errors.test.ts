import { expect, it } from 'vitest';
import * as errors from '../shared/errors.ts';
import { statusOf } from './errors.ts';

const errorClasses = Object.entries(errors).filter(
  ([, value]) => typeof value === 'function' && value.prototype instanceof Error
) as [string, new (message?: string) => Error][];

it.each(errorClasses)('%s maps to a 4xx', (_, ErrorClass) => {
  const status = statusOf(new ErrorClass('x'));
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
});

it('maps any other error to a 500', () => {
  expect(statusOf(new Error('x'))).toBe(500);
});
