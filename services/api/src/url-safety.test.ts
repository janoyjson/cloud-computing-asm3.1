import { describe, expect, it } from 'vitest';

import { assertPublicHttpUrl } from './url-safety.js';

describe('API URL safety', () => {
  it('rejects credentials and non-HTTP URLs', async () => {
    await expect(assertPublicHttpUrl('https://user:pass@example.com', async () => ['93.184.216.34']))
      .rejects.toThrow('URL must not include credentials.');
    await expect(assertPublicHttpUrl('file:///etc/passwd'))
      .rejects.toThrow('URL must use HTTP or HTTPS.');
  });

  it('rejects private, loopback, link-local, and metadata addresses', async () => {
    for (const address of ['10.0.0.4', '127.0.0.1', '169.254.169.254', '192.168.1.10', '::1', 'fd00::1']) {
      await expect(assertPublicHttpUrl('https://internal.example', async () => [address]))
        .rejects.toThrow('URL resolves to a blocked destination.');
    }
  });

  it('accepts a public host after resolving every address', async () => {
    await expect(assertPublicHttpUrl('https://example.com', async () => ['93.184.216.34']))
      .resolves.toBeUndefined();
  });
});
