import { randomUUID } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';

import type { CreateEndpointInput, MonitoredEndpoint, UpdateEndpointInput } from '@cloudsentinel/shared';

import { createEndpoint, updateEndpoint, type EndpointRepository } from './endpoint-store.js';

type DynamoKey = Record<string, NativeAttributeValue>;

interface DynamoEndpointStoreOptions {
  tableName: string;
  ownerIndexName?: string;
  client?: DynamoDBDocumentClient;
  createId?: () => string;
  now?: () => Date;
}

export class DynamoEndpointStore implements EndpointRepository {
  readonly #tableName: string;
  readonly #ownerIndexName: string;
  readonly #client: DynamoDBDocumentClient;
  readonly #createId: (() => string) | undefined;
  readonly #now: (() => Date) | undefined;

  public constructor(options: DynamoEndpointStoreOptions) {
    this.#tableName = options.tableName;
    this.#ownerIndexName = options.ownerIndexName ?? 'ownerId-createdAt-index';
    this.#client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.#createId = options.createId;
    this.#now = options.now;
  }

  public async list(ownerId?: string): Promise<MonitoredEndpoint[]> {
    const endpoints: MonitoredEndpoint[] = [];
    let exclusiveStartKey: DynamoKey | undefined;

    do {
      const response = ownerId
        ? await this.#client.send(new QueryCommand({
            TableName: this.#tableName,
            IndexName: this.#ownerIndexName,
            KeyConditionExpression: 'ownerId = :ownerId',
            ExpressionAttributeValues: { ':ownerId': ownerId },
            ExclusiveStartKey: exclusiveStartKey,
          }))
        : await this.#client.send(new ScanCommand({
            TableName: this.#tableName,
            ExclusiveStartKey: exclusiveStartKey,
          }));

      endpoints.push(...(response.Items ?? []) as MonitoredEndpoint[]);
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return endpoints.sort((left, right) => left.name.localeCompare(right.name));
  }

  public async get(id: string, ownerId?: string): Promise<MonitoredEndpoint | undefined> {
    if (ownerId) {
      const response = await this.#client.send(new QueryCommand({
        TableName: this.#tableName,
        IndexName: this.#ownerIndexName,
        KeyConditionExpression: 'ownerId = :ownerId',
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: { ':ownerId': ownerId, ':id': id },
      }));
      return (response.Items ?? []).find((item) => (item as MonitoredEndpoint).id === id) as MonitoredEndpoint | undefined;
    }

    const response = await this.#client.send(new GetCommand({
      TableName: this.#tableName,
      Key: { id },
    }));

    return response.Item as MonitoredEndpoint | undefined;
  }

  public async create(input: CreateEndpointInput, ownerId?: string): Promise<MonitoredEndpoint> {
    const endpoint = {
      ...createEndpoint(input, {
        createId: this.#createId ?? randomUUID,
        now: this.#now ?? (() => new Date()),
      }),
      ...(ownerId ? { ownerId } : {}),
    };

    await this.#client.send(new PutCommand({
      TableName: this.#tableName,
      Item: endpoint,
      ConditionExpression: 'attribute_not_exists(id)',
    }));

    return endpoint;
  }

  public async update(id: string, input: UpdateEndpointInput, ownerId?: string): Promise<MonitoredEndpoint | undefined> {
    const existing = await this.get(id, ownerId);
    if (!existing) {
      return undefined;
    }

    const endpoint = updateEndpoint(existing, input, this.#now ?? (() => new Date()));
    const response = await this.#client.send(new UpdateCommand({
      TableName: this.#tableName,
      Key: { id },
      UpdateExpression: 'SET #name = :name, #url = :url, #interval = :interval, #enabled = :enabled, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#name': 'name',
        '#url': 'url',
        '#interval': 'intervalMinutes',
        '#enabled': 'enabled',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':name': endpoint.name,
        ':url': endpoint.url,
        ':interval': endpoint.intervalMinutes,
        ':enabled': endpoint.enabled,
        ':updatedAt': endpoint.updatedAt,
        ...(ownerId ? { ':ownerId': ownerId } : {}),
      },
      ConditionExpression: ownerId ? 'attribute_exists(id) AND ownerId = :ownerId' : 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW',
    }));

    return (response.Attributes as MonitoredEndpoint | undefined) ?? endpoint;
  }

  public async delete(id: string, ownerId?: string): Promise<boolean> {
    try {
      const response = await this.#client.send(new DeleteCommand({
        TableName: this.#tableName,
        Key: { id },
        ...(ownerId ? {
          ConditionExpression: 'ownerId = :ownerId',
          ExpressionAttributeValues: { ':ownerId': ownerId },
        } : {}),
        ReturnValues: 'ALL_OLD',
      }));

      return response.Attributes !== undefined;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
}
