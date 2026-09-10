import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';

import type { MonitoredEndpoint } from '@cloudsentinel/shared';

export interface StartedCheckTask {
  taskArn: string;
  status: 'STARTED';
}

export interface CheckTaskStarter {
  start(endpoint: MonitoredEndpoint, notificationSecretId?: string): Promise<StartedCheckTask>;
}

interface EcsCheckTaskStarterOptions {
  cluster: string;
  taskDefinition: string;
  subnets: string[];
  securityGroups: string[];
  containerName?: string;
  assignPublicIp?: boolean;
  client?: ECSClient;
}

export class EcsCheckTaskStarter implements CheckTaskStarter {
  readonly #cluster: string;
  readonly #taskDefinition: string;
  readonly #subnets: string[];
  readonly #securityGroups: string[];
  readonly #containerName: string;
  readonly #assignPublicIp: boolean;
  readonly #client: ECSClient;

  public constructor(options: EcsCheckTaskStarterOptions) {
    this.#cluster = options.cluster;
    this.#taskDefinition = options.taskDefinition;
    this.#subnets = options.subnets;
    this.#securityGroups = options.securityGroups;
    this.#containerName = options.containerName ?? 'monitor-worker';
    this.#assignPublicIp = options.assignPublicIp ?? true;
    this.#client = options.client ?? new ECSClient({});
  }

  public async start(endpoint: MonitoredEndpoint, notificationSecretId?: string): Promise<StartedCheckTask> {
    const response = await this.#client.send(new RunTaskCommand({
      cluster: this.#cluster,
      taskDefinition: this.#taskDefinition,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.#subnets,
          securityGroups: this.#securityGroups,
          assignPublicIp: this.#assignPublicIp ? 'ENABLED' : 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [{
          name: this.#containerName,
          environment: [
            { name: 'MONITOR_ENDPOINT_ID', value: endpoint.id },
            { name: 'MONITOR_TARGET_URL', value: endpoint.url },
            { name: 'MONITOR_SOURCE', value: 'MANUAL' },
            ...(endpoint.ownerId ? [{ name: 'MONITOR_OWNER_ID', value: endpoint.ownerId }] : []),
            ...(endpoint.ownerId ? [{ name: 'NOTIFICATION_SECRET_ID', value: notificationSecretId ?? '' }] : []),
          ],
        }],
      },
    }));

    const failure = response.failures?.[0];
    if (failure) {
      throw new Error(`ECS rejected the monitoring task: ${failure.reason ?? 'unknown reason'}`);
    }

    const taskArn = response.tasks?.[0]?.taskArn;
    if (!taskArn) {
      throw new Error('ECS did not return a monitoring task ARN.');
    }

    return { taskArn, status: 'STARTED' };
  }
}
