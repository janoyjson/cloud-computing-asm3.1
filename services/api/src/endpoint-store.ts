import { randomUUID } from 'node:crypto';

import {
  isMonitoringInterval,
  type CreateEndpointInput,
  type MonitoredEndpoint,
} from '@cloudsentinel/shared';

export class ValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

interface StoreDependencies {
  createId: () => string;
  now: () => Date;
}

const defaultDependencies: StoreDependencies = {
  createId: randomUUID,
  now: () => new Date(),
};

export interface EndpointRepository {
  list(): Promise<MonitoredEndpoint[]>;
  create(input: CreateEndpointInput): Promise<MonitoredEndpoint>;
}

export function createEndpoint(
  input: CreateEndpointInput,
  dependencies: StoreDependencies = defaultDependencies,
): MonitoredEndpoint {
  const normalizedName = input.name.trim();
  if (normalizedName.length === 0 || normalizedName.length > 80) {
    throw new ValidationError('Name must contain between 1 and 80 characters.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    throw new ValidationError('URL must be an absolute HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ValidationError('URL must use HTTP or HTTPS.');
  }

  if (!isMonitoringInterval(input.intervalMinutes)) {
    throw new ValidationError('Interval must be 5, 15, 30, or 60 minutes.');
  }

  const timestamp = dependencies.now().toISOString();
  return {
    id: dependencies.createId(),
    name: normalizedName,
    url: parsedUrl.toString(),
    intervalMinutes: input.intervalMinutes,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class EndpointStore implements EndpointRepository {
  readonly #dependencies: StoreDependencies;
  readonly #items = new Map<string, MonitoredEndpoint>();

  public constructor(
    seed: readonly MonitoredEndpoint[] = [],
    dependencies: StoreDependencies = defaultDependencies,
  ) {
    this.#dependencies = dependencies;
    seed.forEach((item) => this.#items.set(item.id, item));
  }

  public async list(): Promise<MonitoredEndpoint[]> {
    return [...this.#items.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  public async create(input: CreateEndpointInput): Promise<MonitoredEndpoint> {
    const endpoint = createEndpoint(input, this.#dependencies);

    this.#items.set(endpoint.id, endpoint);
    return endpoint;
  }
}
