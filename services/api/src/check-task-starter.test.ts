import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { describe, expect, it, vi } from 'vitest';

import { EcsCheckTaskStarter } from './check-task-starter.js';

const endpoint = {
  id: 'endpoint-123',
  name: 'Production API',
  url: 'https://example.com/health',
  intervalMinutes: 15 as const,
  enabled: true,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

describe('EcsCheckTaskStarter', () => {
  it('starts one Fargate task with endpoint-specific overrides', async () => {
    const send = vi.fn().mockResolvedValue({
      tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/example' }],
    });
    const starter = new EcsCheckTaskStarter({
      cluster: 'cloudsentinel-cluster',
      taskDefinition: 'cloudsentinel-monitor-worker:2',
      subnets: ['subnet-public'],
      securityGroups: ['sg-worker'],
      client: { send } as unknown as ECSClient,
    });

    await expect(starter.start(endpoint)).resolves.toEqual({
      taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/example',
      status: 'STARTED',
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(RunTaskCommand);
    expect(command.input).toMatchObject({
      cluster: 'cloudsentinel-cluster',
      taskDefinition: 'cloudsentinel-monitor-worker:2',
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ['subnet-public'],
          securityGroups: ['sg-worker'],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [{
          name: 'monitor-worker',
          environment: [
            { name: 'MONITOR_ENDPOINT_ID', value: 'endpoint-123' },
            { name: 'MONITOR_TARGET_URL', value: 'https://example.com/health' },
            { name: 'MONITOR_SOURCE', value: 'MANUAL' },
          ],
        }],
      },
    });
  });

  it('rejects an ECS placement failure', async () => {
    const send = vi.fn().mockResolvedValue({ failures: [{ reason: 'RESOURCE:FARGATE' }] });
    const starter = new EcsCheckTaskStarter({
      cluster: 'cloudsentinel-cluster',
      taskDefinition: 'cloudsentinel-monitor-worker:2',
      subnets: ['subnet-public'],
      securityGroups: ['sg-worker'],
      client: { send } as unknown as ECSClient,
    });

    await expect(starter.start(endpoint)).rejects.toThrow('RESOURCE:FARGATE');
  });
});
