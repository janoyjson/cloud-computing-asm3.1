import { describe, expect, it } from 'vitest';

import { EndpointStore, ValidationError } from './endpoint-store.js';

const dependencies = {
  createId: () => 'endpoint-123',
  now: () => new Date('2026-08-26T12:00:00.000Z'),
};

describe('EndpointStore', () => {
  it('creates and lists a normalized endpoint', async () => {
    const store = new EndpointStore([], dependencies);

    const endpoint = await store.create({
      name: ' Client API ',
      url: 'https://api.example.com/health',
      intervalMinutes: 15,
    });

    expect(endpoint).toMatchObject({
      id: 'endpoint-123',
      name: 'Client API',
      enabled: true,
      intervalMinutes: 15,
    });
    await expect(store.list()).resolves.toEqual([endpoint]);
    await expect(store.get('endpoint-123')).resolves.toEqual(endpoint);
    await expect(store.get('missing')).resolves.toBeUndefined();
  });

  it('rejects non-HTTP destinations', async () => {
    const store = new EndpointStore([], dependencies);

    await expect(store.create({
      name: 'Unsafe',
      url: 'file:///etc/passwd',
      intervalMinutes: 15,
    })).rejects.toThrow(ValidationError);
  });

  it('rejects unsupported monitoring intervals', async () => {
    const store = new EndpointStore([], dependencies);

    await expect(store.create({
      name: 'Too frequent',
      url: 'https://example.com',
      intervalMinutes: 1 as 5,
    })).rejects.toThrow('Interval must be 5, 15, 30, or 60 minutes.');
  });

  it('rejects an oversized URL before persistence', async () => {
    const store = new EndpointStore([], dependencies);
    await expect(store.create({
      name: 'Oversized',
      url: `https://example.com/${'x'.repeat(2_050)}`,
      intervalMinutes: 15,
    })).rejects.toThrow('URL must be 2048 characters or fewer.');
  });

  it('updates and deletes an existing endpoint', async () => {
    const store = new EndpointStore([], dependencies);
    await store.create({
      name: 'Client API',
      url: 'https://api.example.com/health',
      intervalMinutes: 15,
    });

    const updated = await store.update('endpoint-123', {
      intervalMinutes: 30,
      enabled: false,
    });

    expect(updated).toMatchObject({
      id: 'endpoint-123',
      intervalMinutes: 30,
      enabled: false,
    });
    await expect(store.delete('endpoint-123')).resolves.toBe(true);
    await expect(store.get('endpoint-123')).resolves.toBeUndefined();
    await expect(store.delete('endpoint-123')).resolves.toBe(false);
  });
});
