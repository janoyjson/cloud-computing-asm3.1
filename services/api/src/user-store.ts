import { randomUUID } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { normalizeEmail, type AuthUser } from './auth.js';

export class UserAlreadyExistsError extends Error {
  public constructor() {
    super('An account with that email already exists.');
    this.name = 'UserAlreadyExistsError';
  }
}

export interface UserRepository {
  getByEmail(email: string): Promise<AuthUser | undefined>;
  create(email: string, passwordHash: string): Promise<AuthUser>;
}

interface UserStoreOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoUserStore implements UserRepository {
  readonly #tableName: string;
  readonly #client: DynamoDBDocumentClient;

  public constructor(options: UserStoreOptions) {
    this.#tableName = options.tableName;
    this.#client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  public async getByEmail(email: string): Promise<AuthUser | undefined> {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await this.#client.send(new ScanCommand({
        TableName: this.#tableName,
        FilterExpression: 'entityType = :entityType AND email = :email',
        ExpressionAttributeValues: { ':entityType': 'USER', ':email': normalizeEmail(email) },
        ExclusiveStartKey: exclusiveStartKey,
      }));
      const user = response.Items?.[0] as AuthUser | undefined;
      if (user) return user;
      exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return undefined;
  }

  public async create(email: string, passwordHash: string): Promise<AuthUser> {
    if (await this.getByEmail(email)) throw new UserAlreadyExistsError();

    const user: AuthUser = {
      id: `user#${randomUUID()}`,
      email: normalizeEmail(email),
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    try {
      await this.#client.send(new PutCommand({
        TableName: this.#tableName,
        Item: { ...user, entityType: 'USER' },
        ConditionExpression: 'attribute_not_exists(id)',
      }));
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new UserAlreadyExistsError();
      }
      throw error;
    }

    return user;
  }
}
