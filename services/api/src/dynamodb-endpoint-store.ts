import { randomUUID } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  type NativeAttributeValue,
} from '@aws-sdk/lib-dynamodb';

import type { CreateEndpointInput, MonitoredEndpoint } from '@cloudsentinel/shared';

import { createEndpoint, type EndpointRepository } from './endpoint-store.js';

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
}
