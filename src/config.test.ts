import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('fills every default from an empty environment', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      dataDir: './data',
      publicDir: './public',
      pageSize: 50,
      tombstoneDays: 90,
      sessionTtlDays: 365,
      bodyLimitBytes: 5 * 1024 * 1024,
      blobLimitBytes: 100 * 1024 * 1024,
      logLevel: 'info',
      trustProxy: false,
      publicUrl: 'http://localhost:3000',
    });
  });

  it('reads and coerces variables', () => {
    const config = loadConfig({
      PORT: '8080',
      PAGE_SIZE: '200',
      TRUST_PROXY: 'true',
      DATA_DIR: '/data',
      PUBLIC_URL: 'https://notes.example',
    });
    expect(config).toMatchObject({
      port: 8080,
      pageSize: 200,
      trustProxy: true,
      dataDir: '/data',
      publicUrl: 'https://notes.example',
    });
  });

  it('defaults the public URL to localhost on the configured port', () => {
    expect(loadConfig({ PORT: '8080' }).publicUrl).toBe('http://localhost:8080');
  });

  it('treats an empty variable as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
  });

  it('caps the page size at 200', () => {
    expect(() => loadConfig({ PAGE_SIZE: '201' })).toThrow(/PAGE_SIZE/);
  });

  it('names every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud', TRUST_PROXY: 'yes' })).toThrow(
      /PORT[\s\S]*LOG_LEVEL[\s\S]*TRUST_PROXY/
    );
  });
});
