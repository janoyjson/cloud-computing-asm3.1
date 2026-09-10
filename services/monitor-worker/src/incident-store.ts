import { randomUUID } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { CheckResult, Incident } from '@cloudsentinel/shared';

export type NotificationKind = 'OUTAGE' | 'RECOVERY';

export interface NotificationOutcome {
  status: 'SENT' | 'FAILED';
  occurredAt: string;
  error?: string;
}

export interface IncidentRepository {
  open(result: CheckResult): Promise<Incident>;
  recover(result: CheckResult): Promise<Incident | undefined>;
  recordNotification(
    incident: Incident,
    kind: NotificationKind,
    outcome: NotificationOutcome,
  ): Promise<void>;
}

interface DynamoIncidentStoreOptions {
  tableName: string;
  documentClient?: DynamoDBDocumentClient;
  createId?: () => string;
}

function isConditionalFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export class DynamoIncidentStore implements IncidentRepository {
  readonly #tableName: string;
  readonly #documentClient: DynamoDBDocumentClient;
  readonly #createId: () => string;

  public constructor(options: DynamoIncidentStoreOptions) {
    this.#tableName = options.tableName;
    this.#documentClient = options.documentClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.#createId = options.createId ?? randomUUID;
  }

  public async open(result: CheckResult): Promise<Incident> {
    const incident: Incident = {
      id: this.#createId(),
      endpointId: result.endpointId,
      ...(result.ownerId ? { ownerId: result.ownerId } : {}),
      openedAt: result.checkedAt,
      status: 'OPEN',
      openingCheckId: `${result.endpointId}#${result.checkedAt}`,
      outageNotificationStatus: 'PENDING',
    };

    await this.#documentClient.send(new PutCommand({
      TableName: this.#tableName,
      Item: incident,
      ConditionExpression: 'attribute_not_exists(endpointId) AND attribute_not_exists(openedAt)',
    }));

    return incident;
  }

  public async recover(result: CheckResult): Promise<Incident | undefined> {
    const response = await this.#documentClient.send(new QueryCommand({
      TableName: this.#tableName,
      KeyConditionExpression: 'endpointId = :endpointId',
      ExpressionAttributeValues: { ':endpointId': result.endpointId },
      ScanIndexForward: false,
      Limit: 1,
      ConsistentRead: true,
    }));
    const incident = response.Items?.[0] as Incident | undefined;
    if (!incident || incident.status !== 'OPEN') {
      return undefined;
    }

    try {
      const updateResponse = await this.#documentClient.send(new UpdateCommand({
        TableName: this.#tableName,
        Key: { endpointId: incident.endpointId, openedAt: incident.openedAt },
        UpdateExpression: 'SET #status = :resolved, recoveredAt = :recoveredAt, recoveryCheckId = :recoveryCheckId, recoveryNotificationStatus = :pending',
        ConditionExpression: '#status = :open',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':open': 'OPEN',
          ':resolved': 'RESOLVED',
          ':recoveredAt': result.checkedAt,
          ':recoveryCheckId': `${result.endpointId}#${result.checkedAt}`,
          ':pending': 'PENDING',
        },
        ReturnValues: 'ALL_NEW',
      }));

      return updateResponse.Attributes as Incident | undefined;
    } catch (error) {
      if (isConditionalFailure(error)) {
        return undefined;
      }
      throw error;
    }
  }

  public async recordNotification(
    incident: Incident,
    kind: NotificationKind,
    outcome: NotificationOutcome,
  ): Promise<void> {
    const prefix = kind === 'OUTAGE' ? 'outage' : 'recovery';
    const values: Record<string, string> = {
      ':notificationStatus': outcome.status,
      ':notificationTime': outcome.occurredAt,
    };
    let updateExpression = `SET ${prefix}NotificationStatus = :notificationStatus, ${prefix}NotifiedAt = :notificationTime`;

    if (outcome.error) {
      updateExpression += `, ${prefix}NotificationError = :notificationError`;
      values[':notificationError'] = outcome.error.slice(0, 240);
    }

    await this.#documentClient.send(new UpdateCommand({
      TableName: this.#tableName,
      Key: { endpointId: incident.endpointId, openedAt: incident.openedAt },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(endpointId) AND attribute_exists(openedAt)',
    }));
  }
}
