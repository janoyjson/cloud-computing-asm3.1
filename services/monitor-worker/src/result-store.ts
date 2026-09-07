import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { CheckResult } from '@cloudsentinel/shared';

interface AwsResultStoreOptions {
  monitorsTableName: string;
  checksTableName: string;
  resultsBucketName: string;
  documentClient?: DynamoDBDocumentClient;
  s3Client?: S3Client;
}

export class AwsResultStore {
  readonly #monitorsTableName: string;
  readonly #checksTableName: string;
  readonly #resultsBucketName: string;
  readonly #documentClient: DynamoDBDocumentClient;
  readonly #s3Client: S3Client;

  public constructor(options: AwsResultStoreOptions) {
    this.#monitorsTableName = options.monitorsTableName;
    this.#checksTableName = options.checksTableName;
    this.#resultsBucketName = options.resultsBucketName;
    this.#documentClient = options.documentClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.#s3Client = options.s3Client ?? new S3Client({});
  }

  public async save(result: CheckResult): Promise<void> {
    await this.#documentClient.send(new PutCommand({
      TableName: this.#checksTableName,
      Item: result,
      ConditionExpression: 'attribute_not_exists(endpointId) AND attribute_not_exists(checkedAt)',
    }));

    await this.#documentClient.send(new UpdateCommand({
      TableName: this.#monitorsTableName,
      Key: { id: result.endpointId },
      UpdateExpression: 'SET latestCheck = :result, updatedAt = :checkedAt',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeValues: {
        ':result': result,
        ':checkedAt': result.checkedAt,
      },
    }));

    await this.#s3Client.send(new PutObjectCommand({
      Bucket: this.#resultsBucketName,
      Key: this.#objectKey(result),
      Body: JSON.stringify(result),
      ContentType: 'application/json',
    }));
  }

  #objectKey(result: CheckResult): string {
    const checkedAt = new Date(result.checkedAt);
    const year = checkedAt.getUTCFullYear();
    const month = String(checkedAt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(checkedAt.getUTCDate()).padStart(2, '0');
    const safeTimestamp = result.checkedAt.replaceAll(':', '-');

    return `checks/year=${year}/month=${month}/day=${day}/endpointId=${encodeURIComponent(result.endpointId)}/${safeTimestamp}.json`;
  }
}
