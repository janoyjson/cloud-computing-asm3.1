import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';

import type { CheckResult, Incident } from '@cloudsentinel/shared';

import { DynamoIncidentStore } from './incident-store.js';

const downCheck: CheckResult = {
  endpointId: 'endpoint-123',
  checkedAt: '2026-09-07T14:10:00.000Z',
  state: 'DOWN',
  source: 'SCHEDULED',
  responseTimeMs: 250,
  statusCode: 503,
};
const openIncident: Incident = {
  id: 'incident-123',
  endpointId: 'endpoint-123',
  openedAt: downCheck.checkedAt,
  status: 'OPEN',
  openingCheckId: `endpoint-123#${downCheck.checkedAt}`,
  outageNotificationStatus: 'PENDING',
};

function store(send: ReturnType<typeof vi.fn>) {
  return new DynamoIncidentStore({
    tableName: 'CloudSentinelIncidents',
    documentClient: { send } as unknown as DynamoDBDocumentClient,
    createId: () => 'incident-123',
  });
}

describe('DynamoIncidentStore', () => {
  it('opens one conditionally unique incident', async () => {
    const send = vi.fn().mockResolvedValue({});

    await expect(store(send).open(downCheck)).resolves.toEqual(openIncident);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      TableName: 'CloudSentinelIncidents',
      Item: openIncident,
      ConditionExpression: 'attribute_not_exists(endpointId) AND attribute_not_exists(openedAt)',
    });
  });

  it('resolves the latest open incident conditionally', async () => {
    const resolvedIncident = {
      ...openIncident,
      status: 'RESOLVED',
      recoveredAt: '2026-09-07T14:15:00.000Z',
      recoveryNotificationStatus: 'PENDING',
    };
    const send = vi.fn()
      .mockResolvedValueOnce({ Items: [openIncident] })
      .mockResolvedValueOnce({ Attributes: resolvedIncident });
    const upCheck = { ...downCheck, state: 'UP' as const, checkedAt: '2026-09-07T14:15:00.000Z' };

    await expect(store(send).recover(upCheck)).resolves.toEqual(resolvedIncident);

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(QueryCommand);
    const command = send.mock.calls[1]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      Key: { endpointId: 'endpoint-123', openedAt: downCheck.checkedAt },
      ConditionExpression: '#status = :open',
    });
  });

  it('does not resolve an already resolved latest incident', async () => {
    const send = vi.fn().mockResolvedValue({ Items: [{ ...openIncident, status: 'RESOLVED' }] });

    await expect(store(send).recover({ ...downCheck, state: 'UP' })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });

  it('records notification delivery state on the incident', async () => {
    const send = vi.fn().mockResolvedValue({});

    await store(send).recordNotification(openIncident, 'OUTAGE', {
      status: 'SENT',
      occurredAt: '2026-09-07T14:11:00.000Z',
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      Key: { endpointId: 'endpoint-123', openedAt: downCheck.checkedAt },
      ExpressionAttributeValues: {
        ':notificationStatus': 'SENT',
        ':notificationTime': '2026-09-07T14:11:00.000Z',
      },
    });
  });
});
