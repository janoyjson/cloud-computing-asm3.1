import { randomUUID } from 'node:crypto';

import {
  isMonitoringInterval,
  type CreateEndpointInput,
  type MonitoredEndpoint,
  type UpdateEndpointInput,
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
  list(ownerId?: string): Promise<MonitoredEndpoint[]>;
  get(id: string, ownerId?: string): Promise<MonitoredEndpoint | undefined>;
  create(input: CreateEndpointInput, ownerId?: string): Promise<MonitoredEndpoint>;
  update(id: string, input: UpdateEndpointInput, ownerId?: string): Promise<MonitoredEndpoint | undefined>;
  delete(id: string, ownerId?: string): Promise<boolean>;
}

export const MAX_MONITOR_URL_LENGTH = 2_048;

export function createEndpoint(
  input: CreateEndpointInput,
  dependencies: StoreDependencies = defaultDependencies,
): MonitoredEndpoint {
  if (typeof input.name !== 'string') {
    throw new ValidationError('Name must contain between 1 and 80 characters.');
  }

  const normalizedName = input.name.trim();
  if (normalizedName.length === 0 || normalizedName.length > 80) {
    throw new ValidationError('Name must contain between 1 and 80 characters.');
  }

  if (typeof input.url !== 'string') {
    throw new ValidationError('URL must be an absolute HTTP or HTTPS URL.');
  }

  if (input.url.length > MAX_MONITOR_URL_LENGTH) {
    throw new ValidationError(`URL must be ${MAX_MONITOR_URL_LENGTH} characters or fewer.`);
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

export function updateEndpoint(
  endpoint: MonitoredEndpoint,
  input: UpdateEndpointInput,
  now: () => Date = () => new Date(),
): MonitoredEndpoint {
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new ValidationError('Enabled must be true or false.');
  }

  const normalized = createEndpoint({
    name: input.name ?? endpoint.name,
    url: input.url ?? endpoint.url,
    intervalMinutes: input.intervalMinutes ?? endpoint.intervalMinutes,
  }, {
    createId: () => endpoint.id,
    now,
  });

  return {
    ...endpoint,
    name: normalized.name,
    url: normalized.url,
    intervalMinutes: normalized.intervalMinutes,
    enabled: input.enabled ?? endpoint.enabled,
    updatedAt: normalized.updatedAt,
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

  public async list(ownerId?: string): Promise<MonitoredEndpoint[]> {
    return [...this.#items.values()]
      .filter((item) => !ownerId || item.ownerId === ownerId)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public async get(id: string, ownerId?: string): Promise<MonitoredEndpoint | undefined> {
    const endpoint = this.#items.get(id);
    return endpoint && (!ownerId || endpoint.ownerId === ownerId) ? endpoint : undefined;
  }

  public async create(input: CreateEndpointInput, ownerId?: string): Promise<MonitoredEndpoint> {
    const endpoint = { ...createEndpoint(input, this.#dependencies), ...(ownerId ? { ownerId } : {}) };

    this.#items.set(endpoint.id, endpoint);
    return endpoint;
  }

  public async update(id: string, input: UpdateEndpointInput, ownerId?: string): Promise<MonitoredEndpoint | undefined> {
    const existing = await this.get(id, ownerId);
    if (!existing) {
      return undefined;
    }

    const endpoint = updateEndpoint(existing, input, this.#dependencies.now);
    this.#items.set(id, endpoint);
    return endpoint;
  }

  public async delete(id: string, ownerId?: string): Promise<boolean> {
    if (!await this.get(id, ownerId)) return false;
    return this.#items.delete(id);
  }
}
