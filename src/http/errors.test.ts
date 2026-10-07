import Fastify from 'fastify';
import { expect, it } from 'vitest';
import * as errors from '../shared/errors.ts';
import { registerErrorHandler, statusOf } from './errors.ts';

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

it('keeps the 5xx status of an error that carries one, without its message', async () => {
  const app = Fastify();
  registerErrorHandler(app);
  app.get('/', () => {
    throw Object.assign(new Error('secret'), { statusCode: 503 });
  });
  const response = await app.inject('/');
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({
    type: 'about:blank',
    title: 'Service Unavailable',
    status: 503,
  });
});
