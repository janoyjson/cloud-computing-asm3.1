import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { describe, expect, it, vi } from 'vitest';

import { discordWebhookSecretId } from '@cloudsentinel/shared';

import { SecretsManagerDiscordWebhookStore } from './discord-webhook-store.js';

describe('SecretsManagerDiscordWebhookStore', () => {
  it('stores each owner webhook under a separate secret without returning its URL', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new SecretsManagerDiscordWebhookStore({ client: { send } as unknown as SecretsManagerClient });

    await store.set('user#one', 'https://discord.com/api/webhooks/123/token-one');

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutSecretValueCommand);
    expect(command.input).toMatchObject({
      SecretId: discordWebhookSecretId('user#one'),
      SecretString: JSON.stringify({ url: 'https://discord.com/api/webhooks/123/token-one' }),
    });
  });

  it('creates a missing owner secret and reports configuration without exposing its value', async () => {
    const missing = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
    const send = vi.fn()
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ ARN: 'arn:secret' })
      .mockResolvedValueOnce({});
    const store = new SecretsManagerDiscordWebhookStore({ client: { send } as unknown as SecretsManagerClient });

    await store.set('user#two', 'https://discord.com/api/webhooks/456/token-two');
    const settings = await store.get('user#two');
    expect(settings).toEqual({ configured: true });

    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateSecretCommand);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DescribeSecretCommand);
    expect(JSON.stringify(settings)).not.toContain('token-two');
  });

  it('rejects non-Discord webhook destinations before writing a secret', async () => {
    const send = vi.fn();
    const store = new SecretsManagerDiscordWebhookStore({ client: { send } as unknown as SecretsManagerClient });

    await expect(store.set('user#three', 'https://example.com/webhook'))
      .rejects.toThrow('HTTPS Discord webhook URL');
    expect(send).not.toHaveBeenCalled();
  });

  it('force-removes the owner secret', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new SecretsManagerDiscordWebhookStore({ client: { send } as unknown as SecretsManagerClient });

    await store.remove('user#four');

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteSecretCommand);
    expect(command.input).toMatchObject({
      SecretId: discordWebhookSecretId('user#four'),
      ForceDeleteWithoutRecovery: true,
    });
  });
});
