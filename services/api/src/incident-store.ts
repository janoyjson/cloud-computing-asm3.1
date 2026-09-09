import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import type { Incident } from '@cloudsentinel/shared';

export interface IncidentRepository {
  list(endpointId: string): Promise<Incident[]>;
}

interface DynamoIncidentStoreOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoIncidentStore implements IncidentRepository {
  readonly #tableName: string;
  readonly #client: DynamoDBDocumentClient;

  public constructor(options: DynamoIncidentStoreOptions) {
    this.#tableName = options.tableName;
    this.#client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  public async list(endpointId: string): Promise<Incident[]> {
    const response = await this.#client.send(new QueryCommand({
      TableName: this.#tableName,
      KeyConditionExpression: 'endpointId = :endpointId',
      ExpressionAttributeValues: { ':endpointId': endpointId },
      ScanIndexForward: false,
      Limit: 20,
    }));

    return (response.Items ?? []) as Incident[];
  }
}
