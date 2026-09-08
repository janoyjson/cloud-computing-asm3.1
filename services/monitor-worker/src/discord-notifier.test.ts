import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { describe, expect, it, vi } from 'vitest';

import type { Incident } from '@cloudsentinel/shared';

import { DiscordWebhookNotifier } from './discord-notifier.js';

const incident: Incident = {
  id: 'incident-123',
  endpointId: 'endpoint-123',
  openedAt: '2026-09-07T14:10:00.000Z',
  status: 'OPEN',
  openingCheckId: 'endpoint-123#2026-09-07T14:10:00.000Z',
  outageNotificationStatus: 'PENDING',
};

describe('DiscordWebhookNotifier', () => {
  it('loads the protected URL and sends an outage message without mentions', async () => {
    const secretSend = vi.fn().mockResolvedValue({
      SecretString: JSON.stringify({ url: 'https://discord.com/api/webhooks/123/test-token' }),
    });
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const notifier = new DiscordWebhookNotifier({
      secretId: 'cloudsentinel/discord-webhook',
      secretsClient: { send: secretSend } as unknown as SecretsManagerClient,
      fetchImplementation,
    });

    await notifier.send({
      kind: 'OUTAGE',
      incident,
      endpointName: 'Production API',
      endpointUrl: 'https://example.com/health',
      check: {
        endpointId: 'endpoint-123',
        checkedAt: incident.openedAt,
        state: 'DOWN',
        source: 'SCHEDULED',
        responseTimeMs: 250,
        statusCode: 503,
      },
    });

    expect(secretSend).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, request] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe('https://discord.com/api/webhooks/123/test-token?wait=true');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      username: 'CloudSentinel',
      allowed_mentions: { parse: [] },
    });
  });

  it('rejects a non-Discord secret destination before sending', async () => {
    const secretSend = vi.fn().mockResolvedValue({
      SecretString: JSON.stringify({ url: 'https://example.com/webhook' }),
    });
    const fetchImplementation = vi.fn<typeof fetch>();
    const notifier = new DiscordWebhookNotifier({
      secretId: 'cloudsentinel/discord-webhook',
      secretsClient: { send: secretSend } as unknown as SecretsManagerClient,
      fetchImplementation,
    });

    await expect(notifier.send({
      kind: 'OUTAGE',
      incident,
      endpointName: 'Production API',
      endpointUrl: 'https://example.com/health',
      check: {
        endpointId: 'endpoint-123',
        checkedAt: incident.openedAt,
        state: 'DOWN',
        source: 'SCHEDULED',
        responseTimeMs: 250,
      },
    })).rejects.toThrow('approved Discord webhook URL');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
