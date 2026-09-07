import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { describe, expect, it, vi } from 'vitest';

import type { MonitoredEndpoint } from '@cloudsentinel/shared';

import { EventBridgeRecurringCheckScheduler, scheduleName } from './recurring-check-scheduler.js';

const endpoint: MonitoredEndpoint = {
  id: 'endpoint-123',
  name: 'Production API',
  url: 'https://example.com/health',
  intervalMinutes: 15,
  enabled: true,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

function scheduler(send: ReturnType<typeof vi.fn>) {
  return new EventBridgeRecurringCheckScheduler({
    clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/cloudsentinel-cluster',
    taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/cloudsentinel-monitor-worker:2',
    roleArn: 'arn:aws:iam::123456789012:role/LabRole',
    subnets: ['subnet-123'],
    securityGroups: ['sg-123'],
    client: { send } as unknown as SchedulerClient,
  });
}

describe('EventBridgeRecurringCheckScheduler', () => {
  it('updates an existing recurring Fargate schedule', async () => {
    const send = vi.fn().mockResolvedValue({});

    await scheduler(send).upsert(endpoint);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateScheduleCommand);
    expect(command.input).toMatchObject({
      Name: 'cloudsentinel-endpoint-123',
      ScheduleExpression: 'rate(15 minutes)',
      State: 'ENABLED',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/cloudsentinel-cluster',
        RoleArn: 'arn:aws:iam::123456789012:role/LabRole',
        EcsParameters: {
          TaskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/cloudsentinel-monitor-worker:2',
          LaunchType: 'FARGATE',
        },
      },
    });
    expect(JSON.parse(command.input.Target.Input)).toEqual({
      containerOverrides: [{
        name: 'monitor-worker',
        environment: [
          { name: 'MONITOR_ENDPOINT_ID', value: 'endpoint-123' },
          { name: 'MONITOR_TARGET_URL', value: 'https://example.com/health' },
          { name: 'MONITOR_SOURCE', value: 'SCHEDULED' },
        ],
      }],
    });
  });

  it('creates the schedule when an update reports that it does not exist', async () => {
    const missing = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
    const send = vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce({});

    await scheduler(send).upsert({ ...endpoint, enabled: false });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(UpdateScheduleCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(CreateScheduleCommand);
    expect(send.mock.calls[1]?.[0].input.State).toBe('DISABLED');
  });

  it('removes a schedule and treats an already absent schedule as success', async () => {
    const missing = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
    const send = vi.fn().mockRejectedValue(missing);

    await expect(scheduler(send).remove('endpoint-123')).resolves.toBeUndefined();

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteScheduleCommand);
    expect(command.input).toEqual({ Name: 'cloudsentinel-endpoint-123', GroupName: 'default' });
  });

  it('normalizes schedule names to Scheduler-compatible characters', () => {
    expect(scheduleName('customer/api status')).toBe('cloudsentinel-customer-api-status');
  });
});
