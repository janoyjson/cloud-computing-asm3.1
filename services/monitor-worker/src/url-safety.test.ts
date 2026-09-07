import { describe, expect, it, vi } from 'vitest';

import { assertPublicHttpUrl } from './url-safety.js';

describe('assertPublicHttpUrl', () => {
  it('accepts an HTTPS hostname that resolves publicly', async () => {
    const url = await assertPublicHttpUrl('https://example.com/health', async () => ['93.184.216.34']);
    expect(url.toString()).toBe('https://example.com/health');
  });

  it('rejects credentials embedded in a URL', async () => {
    await expect(assertPublicHttpUrl(
      'https://user:password@example.com',
      async () => ['93.184.216.34'],
    )).rejects.toThrow('must not include credentials');
  });

  it('rejects localhost without attempting DNS', async () => {
    const resolver = vi.fn();
    await expect(assertPublicHttpUrl('http://localhost/admin', resolver)).rejects.toThrow('blocked destination');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    await expect(assertPublicHttpUrl(
      'https://internal.example.com',
      async () => ['10.0.0.5'],
    )).rejects.toThrow('blocked destination');
  });
});
