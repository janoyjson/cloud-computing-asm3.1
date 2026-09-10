import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
  type CreateScheduleCommandInput,
} from '@aws-sdk/client-scheduler';

import type { MonitoredEndpoint } from '@cloudsentinel/shared';

export interface RecurringCheckScheduler {
  upsert(endpoint: MonitoredEndpoint, notificationSecretId?: string): Promise<void>;
  remove(endpointId: string): Promise<void>;
}

interface EventBridgeRecurringCheckSchedulerOptions {
  clusterArn: string;
  taskDefinitionArn: string;
  roleArn: string;
  subnets: string[];
  securityGroups: string[];
  containerName?: string;
  assignPublicIp?: boolean;
  groupName?: string;
  client?: SchedulerClient;
}

function isResourceNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResourceNotFoundException';
}

export function scheduleName(endpointId: string): string {
  const safeId = endpointId.replace(/[^a-zA-Z0-9-_.]/g, '-');
  return `cloudsentinel-${safeId}`.slice(0, 64);
}

export class EventBridgeRecurringCheckScheduler implements RecurringCheckScheduler {
  readonly #clusterArn: string;
  readonly #taskDefinitionArn: string;
  readonly #roleArn: string;
  readonly #subnets: string[];
  readonly #securityGroups: string[];
  readonly #containerName: string;
  readonly #assignPublicIp: boolean;
  readonly #groupName: string;
  readonly #client: SchedulerClient;

  public constructor(options: EventBridgeRecurringCheckSchedulerOptions) {
    this.#clusterArn = options.clusterArn;
    this.#taskDefinitionArn = options.taskDefinitionArn;
    this.#roleArn = options.roleArn;
    this.#subnets = options.subnets;
    this.#securityGroups = options.securityGroups;
    this.#containerName = options.containerName ?? 'monitor-worker';
    this.#assignPublicIp = options.assignPublicIp ?? true;
    this.#groupName = options.groupName ?? 'default';
    this.#client = options.client ?? new SchedulerClient({});
  }

  public async upsert(endpoint: MonitoredEndpoint, notificationSecretId?: string): Promise<void> {
    const definition = this.#definition(endpoint, notificationSecretId);

    try {
      await this.#client.send(new UpdateScheduleCommand(definition));
    } catch (error) {
      if (!isResourceNotFound(error)) {
        throw error;
      }

      await this.#client.send(new CreateScheduleCommand(definition));
    }
  }

  public async remove(endpointId: string): Promise<void> {
    try {
      await this.#client.send(new DeleteScheduleCommand({
        Name: scheduleName(endpointId),
        GroupName: this.#groupName,
      }));
    } catch (error) {
      if (!isResourceNotFound(error)) {
        throw error;
      }
    }
  }

  #definition(endpoint: MonitoredEndpoint, notificationSecretId?: string): CreateScheduleCommandInput {
    return {
      Name: scheduleName(endpoint.id),
      GroupName: this.#groupName,
      Description: `Recurring availability check for CloudSentinel endpoint ${endpoint.id}`,
      ScheduleExpression: `rate(${endpoint.intervalMinutes} minutes)`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      State: endpoint.enabled ? 'ENABLED' : 'DISABLED',
      Target: {
        Arn: this.#clusterArn,
        RoleArn: this.#roleArn,
        EcsParameters: {
          TaskDefinitionArn: this.#taskDefinitionArn,
          LaunchType: 'FARGATE',
          TaskCount: 1,
          EnableECSManagedTags: true,
          EnableExecuteCommand: false,
          NetworkConfiguration: {
            awsvpcConfiguration: {
              Subnets: this.#subnets,
              SecurityGroups: this.#securityGroups,
              AssignPublicIp: this.#assignPublicIp ? 'ENABLED' : 'DISABLED',
            },
          },
        },
        Input: JSON.stringify({
          containerOverrides: [{
            name: this.#containerName,
            environment: [
              { name: 'MONITOR_ENDPOINT_ID', value: endpoint.id },
              { name: 'MONITOR_TARGET_URL', value: endpoint.url },
              { name: 'MONITOR_SOURCE', value: 'SCHEDULED' },
              ...(endpoint.ownerId ? [{ name: 'MONITOR_OWNER_ID', value: endpoint.ownerId }] : []),
              ...(endpoint.ownerId ? [{ name: 'NOTIFICATION_SECRET_ID', value: notificationSecretId ?? '' }] : []),
            ],
          }],
        }),
        RetryPolicy: {
          MaximumEventAgeInSeconds: 900,
          MaximumRetryAttempts: 1,
        },
      },
    };
  }
}
