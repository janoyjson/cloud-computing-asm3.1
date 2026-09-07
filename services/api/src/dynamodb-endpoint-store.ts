import { randomUUID } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';

import type { CreateEndpointInput, MonitoredEndpoint, UpdateEndpointInput } from '@cloudsentinel/shared';

import { createEndpoint, updateEndpoint, type EndpointRepository } from './endpoint-store.js';

type DynamoKey = Record<string, NativeAttributeValue>;

interface DynamoEndpointStoreOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
  createId?: () => string;
  now?: () => Date;
}

export class DynamoEndpointStore implements EndpointRepository {
  readonly #tableName: string;
  readonly #client: DynamoDBDocumentClient;
  readonly #createId: (() => string) | undefined;
  readonly #now: (() => Date) | undefined;

  public constructor(options: DynamoEndpointStoreOptions) {
    this.#tableName = options.tableName;
    this.#client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.#createId = options.createId;
    this.#now = options.now;
  }

  public async list(): Promise<MonitoredEndpoint[]> {
    const endpoints: MonitoredEndpoint[] = [];
    let exclusiveStartKey: DynamoKey | undefined;

    do {
      const response = await this.#client.send(new ScanCommand({
        TableName: this.#tableName,
        ExclusiveStartKey: exclusiveStartKey,
      }));

      endpoints.push(...(response.Items ?? []) as MonitoredEndpoint[]);
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return endpoints.sort((left, right) => left.name.localeCompare(right.name));
  }

  public async get(id: string): Promise<MonitoredEndpoint | undefined> {
    const response = await this.#client.send(new GetCommand({
      TableName: this.#tableName,
      Key: { id },
    }));

    return response.Item as MonitoredEndpoint | undefined;
  }

  public async create(input: CreateEndpointInput): Promise<MonitoredEndpoint> {
    const endpoint = createEndpoint(input, {
      createId: this.#createId ?? randomUUID,
      now: this.#now ?? (() => new Date()),
    });

    await this.#client.send(new PutCommand({
      TableName: this.#tableName,
      Item: endpoint,
      ConditionExpression: 'attribute_not_exists(id)',
    }));

    return endpoint;
  }

  public async update(id: string, input: UpdateEndpointInput): Promise<MonitoredEndpoint | undefined> {
    const existing = await this.get(id);
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
      },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW',
    }));

    return (response.Attributes as MonitoredEndpoint | undefined) ?? endpoint;
  }

  public async delete(id: string): Promise<boolean> {
    const response = await this.#client.send(new DeleteCommand({
      TableName: this.#tableName,
      Key: { id },
      ReturnValues: 'ALL_OLD',
    }));

    return response.Attributes !== undefined;
  }
}
