import { useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  calculateUptimePercent,
  getEndpointState,
  monitoringIntervals,
  type CheckResult,
  type CreateEndpointInput,
  type MonitoredEndpoint,
  type MonitoringIntervalMinutes,
} from '@cloudsentinel/shared';

import {
  addMockEndpoint,
  applyMockCheck,
  initialChecks,
  initialEndpoints,
} from './mock-cloudsentinel.js';
import { CloudSentinelApiClient } from './api-client.js';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const apiClient = apiBaseUrl ? new CloudSentinelApiClient(apiBaseUrl) : undefined;
const isAwsMode = apiClient !== undefined;
const checkPollIntervalMs = 5_000;
const checkPollAttempts = 12;

const initialForm: CreateEndpointInput = {
  name: '',
  url: '',
  intervalMinutes: 15,
};

function formatTime(value: string | undefined) {
  if (!value) {
    return 'Awaiting first check';
  }

  return new Intl.DateTimeFormat('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function StatusBadge({ endpoint }: { endpoint: MonitoredEndpoint }) {
  const state = getEndpointState(endpoint);
  return <span className={`status status-${state.toLowerCase()}`}>{state}</span>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function App() {
  const [endpoints, setEndpoints] = useState<MonitoredEndpoint[]>(isAwsMode ? [] : initialEndpoints);
  const [checks, setChecks] = useState<CheckResult[]>(isAwsMode ? [] : initialChecks);
  const [form, setForm] = useState<CreateEndpointInput>(initialForm);
  const [notice, setNotice] = useState(
    isAwsMode ? 'Loading monitors from AWS...' : 'Local fallback mode: no AWS resources are being used.',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runningEndpointIds, setRunningEndpointIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!apiClient) {
      return;
    }

    let active = true;
    apiClient.listEndpoints()
      .then((items) => {
        if (active) {
          setEndpoints(items);
          setNotice(`Connected to AWS. Loaded ${items.length} monitored endpoints.`);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const reason = error instanceof Error ? error.message : 'Unknown browser error';
          setNotice(`Could not load monitors from AWS: ${reason}`);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const up = endpoints.filter((endpoint) => getEndpointState(endpoint) === 'UP').length;
    const down = endpoints.filter((endpoint) => getEndpointState(endpoint) === 'DOWN').length;
    return {
      up,
      down,
      total: endpoints.length,
      uptime: calculateUptimePercent(checks),
    };
  }, [checks, endpoints]);

  async function submitEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      if (apiClient) {
        const endpoint = await apiClient.createEndpoint(form);
        setEndpoints((current) => [endpoint, ...current]);
        setNotice(`${endpoint.name} was saved through API Gateway, Lambda, and DynamoDB.`);
      } else {
        const createdAt = new Date().toISOString();
        setEndpoints((current) => addMockEndpoint(current, form, crypto.randomUUID(), createdAt));
        setNotice(`${form.name.trim()} added in local fallback mode.`);
      }
      setForm(initialForm);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The endpoint could not be created.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runCheck(endpointId: string) {
    if (apiClient) {
      const endpoint = endpoints.find((candidate) => candidate.id === endpointId);
      const previousCheckedAt = endpoint?.latestCheck?.checkedAt;
      setRunningEndpointIds((current) => new Set(current).add(endpointId));

      try {
        await apiClient.startCheck(endpointId);
        setNotice(`Fargate check started for ${endpoint?.name ?? endpointId}. Waiting for its result...`);

        for (let attempt = 0; attempt < checkPollAttempts; attempt += 1) {
          await delay(checkPollIntervalMs);
          const refreshedEndpoints = await apiClient.listEndpoints();
          setEndpoints(refreshedEndpoints);
          const refreshedEndpoint = refreshedEndpoints.find((candidate) => candidate.id === endpointId);
          const latestCheck = refreshedEndpoint?.latestCheck;

          if (latestCheck && latestCheck.checkedAt !== previousCheckedAt) {
            setChecks((current) => [
              latestCheck,
              ...current.filter((check) => check.checkedAt !== latestCheck.checkedAt),
            ]);
            setNotice(
              `${refreshedEndpoint.name} is ${latestCheck.state} (${latestCheck.responseTimeMs} ms).`,
            );
            return;
          }
        }

        setNotice('The Fargate task started, but its result is taking longer than one minute.');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'The availability check could not be started.');
      } finally {
        setRunningEndpointIds((current) => {
          const next = new Set(current);
          next.delete(endpointId);
          return next;
        });
      }
      return;
    }

    const checkedAt = new Date().toISOString();
    const update = applyMockCheck(endpoints, endpointId, checkedAt);
    setEndpoints(update.endpoints);
    setChecks((current) => [update.result, ...current]);
    const endpointName = update.endpoints.find((endpoint) => endpoint.id === endpointId)?.name;
    setNotice(`Mock check completed for ${endpointName ?? 'endpoint'} in 128 ms.`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="CloudSentinel home">
          <span className="brand-mark">CS</span>
          <span>
            <strong>CloudSentinel</strong>
            <small>Deployment health</small>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          <a className="nav-active" href="#overview">Overview</a>
          <a href="#endpoints">Endpoints</a>
          <a href="#activity">Activity</a>
          <a href="#architecture">Architecture</a>
        </nav>
        <div className="phase-card">
          <span>Current milestone</span>
          <strong>Phase 3 of 8</strong>
          <div className="progress"><span /></div>
          <small>Container monitoring</small>
        </div>
      </aside>

      <main id="top">
        <header className="topbar">
          <div>
            <span className="eyebrow">Wednesday, 26 August</span>
            <h1>Deployment overview</h1>
          </div>
          <span className="environment"><i /> {isAwsMode ? 'AWS live environment' : 'Local fallback environment'}</span>
        </header>

        <div className="notice" role="status">{notice}</div>

        <section id="overview" className="metric-grid" aria-label="Monitoring summary">
          <article className="metric-card metric-primary">
            <span>Overall uptime</span>
            <strong>{summary.uptime === null ? '--' : `${summary.uptime}%`}</strong>
            <small>{isAwsMode ? 'Awaiting the monitoring worker' : 'Based on local sample checks'}</small>
          </article>
          <article className="metric-card">
            <span>Monitored endpoints</span>
            <strong>{summary.total}</strong>
            <small>{summary.total} schedules planned</small>
          </article>
          <article className="metric-card metric-good">
            <span>Operational</span>
            <strong>{summary.up}</strong>
            <small>Latest check succeeded</small>
          </article>
          <article className="metric-card metric-bad">
            <span>Needs attention</span>
            <strong>{summary.down}</strong>
            <small>Based on latest check state</small>
          </article>
        </section>

        <section className="content-grid">
          <article id="endpoints" className="panel endpoints-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Live inventory</span>
                <h2>Monitored endpoints</h2>
              </div>
              <span className="count-pill">{summary.total} total</span>
            </div>

            <div className="endpoint-list">
              {endpoints.map((endpoint) => {
                const isRunning = runningEndpointIds.has(endpoint.id);
                return <div className="endpoint-row" key={endpoint.id}>
                  <div className={`pulse pulse-${getEndpointState(endpoint).toLowerCase()}`} />
                  <div className="endpoint-identity">
                    <strong>{endpoint.name}</strong>
                    <span>{endpoint.url}</span>
                  </div>
                  <div className="endpoint-meta">
                    <span>Every {endpoint.intervalMinutes} min</span>
                    <small>{formatTime(endpoint.latestCheck?.checkedAt)}</small>
                  </div>
                  <StatusBadge endpoint={endpoint} />
                  <button
                    className="button-secondary"
                    disabled={isRunning}
                    type="button"
                    onClick={() => void runCheck(endpoint.id)}
                  >
                    {isRunning ? 'Checking...' : 'Run check'}
                  </button>
                </div>
              })}
            </div>
          </article>

          <aside className="panel add-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{isAwsMode ? 'Live AWS workflow' : 'Local workflow'}</span>
                <h2>Add endpoint</h2>
              </div>
            </div>
            <form onSubmit={submitEndpoint}>
              <label>
                Display name
                <input
                  required
                  maxLength={80}
                  placeholder="Client production API"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label>
                Endpoint URL
                <input
                  required
                  type="url"
                  placeholder="https://api.example.com/health"
                  value={form.url}
                  onChange={(event) => setForm({ ...form, url: event.target.value })}
                />
              </label>
              <label>
                Check interval
                <select
                  value={form.intervalMinutes}
                  onChange={(event) => setForm({
                    ...form,
                    intervalMinutes: Number(event.target.value) as MonitoringIntervalMinutes,
                  })}
                >
                  {monitoringIntervals.map((interval) => (
                    <option key={interval} value={interval}>Every {interval} minutes</option>
                  ))}
                </select>
              </label>
              <button className="button-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Add monitored endpoint'}
              </button>
              <p>
                {isAwsMode
                  ? 'Creates a persistent record through API Gateway, Lambda, and DynamoDB.'
                  : 'Set VITE_API_BASE_URL to connect this dashboard to AWS.'}
              </p>
            </form>
          </aside>
        </section>

        <section className="bottom-grid">
          <article id="activity" className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Most recent first</span>
                <h2>Check activity</h2>
              </div>
            </div>
            <div className="activity-table" role="table" aria-label="Recent check activity">
              {checks.length === 0 && (
                <p className="empty-state">Run a check to load recent Fargate activity.</p>
              )}
              {checks.slice(0, 5).map((check, index) => {
                const endpoint = endpoints.find((candidate) => candidate.id === check.endpointId);
                return (
                  <div className="activity-row" role="row" key={`${check.endpointId}-${check.checkedAt}-${index}`}>
                    <span className={`activity-state state-${check.state.toLowerCase()}`}>{check.state}</span>
                    <strong>{endpoint?.name ?? check.endpointId}</strong>
                    <span>{check.statusCode ?? 'Network error'}</span>
                    <span>{check.responseTimeMs} ms</span>
                    <time>{formatTime(check.checkedAt)}</time>
                  </div>
                );
              })}
            </div>
          </article>

          <article id="architecture" className="panel architecture-panel">
            <div>
              <span className="eyebrow">Next deployed path</span>
              <h2>From dashboard to evidence</h2>
              <p>Each phase adds one demonstrable, automated path while keeping the UI usable.</p>
            </div>
            <div className="flow" aria-label="Planned AWS request flow">
              <span>React</span><i>1</i><span>API Gateway</span><i>2</i><span>Lambda</span><i>3</i><span>DynamoDB</span>
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
