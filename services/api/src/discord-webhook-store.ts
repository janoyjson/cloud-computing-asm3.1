import {
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import {
  discordWebhookSecretId,
  isApprovedDiscordWebhookUrl,
} from '@cloudsentinel/shared';

import { ValidationError } from './endpoint-store.js';

export interface DiscordWebhookSettings {
  configured: boolean;
}

export interface DiscordWebhookStore {
  get(ownerId: string): Promise<DiscordWebhookSettings>;
  getSecretId(ownerId: string): Promise<string | undefined>;
  set(ownerId: string, webhookUrl: string): Promise<void>;
  remove(ownerId: string): Promise<void>;
}

interface DiscordWebhookStoreOptions {
  client?: SecretsManagerClient;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResourceNotFoundException';
}

function secretValue(webhookUrl: string): string {
  return JSON.stringify({ url: webhookUrl });
}

export class SecretsManagerDiscordWebhookStore implements DiscordWebhookStore {
  readonly #client: SecretsManagerClient;

  public constructor(options: DiscordWebhookStoreOptions = {}) {
    this.#client = options.client ?? new SecretsManagerClient({});
  }

  public async get(ownerId: string): Promise<DiscordWebhookSettings> {
    return { configured: await this.getSecretId(ownerId) !== undefined };
  }

  public async getSecretId(ownerId: string): Promise<string | undefined> {
    const secretId = discordWebhookSecretId(ownerId);
    try {
      const response = await this.#client.send(new DescribeSecretCommand({ SecretId: secretId }));
      return response.DeletedDate ? undefined : secretId;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  public async set(ownerId: string, webhookUrl: string): Promise<void> {
    const normalizedUrl = webhookUrl.trim();
    if (!isApprovedDiscordWebhookUrl(normalizedUrl)) {
      throw new ValidationError('Webhook URL must be an HTTPS Discord webhook URL.');
    }

    const secretId = discordWebhookSecretId(ownerId);
    try {
      await this.#client.send(new PutSecretValueCommand({
        SecretId: secretId,
        SecretString: secretValue(normalizedUrl),
      }));
    } catch (error) {
      if (!isNotFound(error)) throw error;

      await this.#client.send(new CreateSecretCommand({
        Name: secretId,
        Description: `Discord webhook for CloudSentinel owner ${ownerId}`,
        SecretString: secretValue(normalizedUrl),
      }));
    }
  }

  public async remove(ownerId: string): Promise<void> {
    try {
      await this.#client.send(new DeleteSecretCommand({
        SecretId: discordWebhookSecretId(ownerId),
        ForceDeleteWithoutRecovery: true,
      }));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}
