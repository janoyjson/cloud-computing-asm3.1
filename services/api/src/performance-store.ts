import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { PerformanceResult } from '@cloudsentinel/shared';

interface PerformanceStoreOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoPerformanceStore {
  readonly #tableName: string;
  readonly #client: DynamoDBDocumentClient;

  public constructor(options: PerformanceStoreOptions) {
    this.#tableName = options.tableName;
    this.#client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  public async save(result: PerformanceResult): Promise<void> {
    await this.#client.send(new PutCommand({
      TableName: this.#tableName,
      Item: result,
      ConditionExpression: 'attribute_not_exists(endpointId) AND attribute_not_exists(measuredAt)',
    }));
  }

  public async list(endpointId: string, limit = 20): Promise<PerformanceResult[]> {
    const response = await this.#client.send(new QueryCommand({
      TableName: this.#tableName,
      KeyConditionExpression: 'endpointId = :endpointId',
      ExpressionAttributeValues: { ':endpointId': endpointId },
      ScanIndexForward: false,
      Limit: limit,
    }));
    return (response.Items ?? []) as PerformanceResult[];
  }
}
