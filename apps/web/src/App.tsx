import { useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  calculateUptimePercent,
  getEndpointState,
  monitoringIntervals,
  type AnalyticsOverview,
  type CheckResult,
  type CreateEndpointInput,
  type Incident,
  type MonitoredEndpoint,
  type MonitoringIntervalMinutes,
  type PerformanceResult,
  type UpdateEndpointInput,
} from '@cloudsentinel/shared';

import {
  addMockEndpoint,
  applyMockCheck,
  initialChecks,
  initialEndpoints,
} from './mock-cloudsentinel.js';
import { CloudSentinelApiClient } from './api-client.js';
import { JwtAuthClient, type JwtSession } from './jwt-auth.js';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const apiAccessToken = import.meta.env.VITE_API_ACCESS_TOKEN?.trim();
const apiClient = apiBaseUrl && !apiBaseUrl.includes('your-api-id')
  ? new CloudSentinelApiClient(apiBaseUrl, window.fetch.bind(window), apiAccessToken)
  : undefined;
const isAwsMode = apiClient !== undefined;
const jwtAuth = isAwsMode && apiBaseUrl ? new JwtAuthClient(apiBaseUrl) : undefined;
const requiresAuthentication = jwtAuth !== undefined;
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

function formatCurrentDate() {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function App() {
  const [endpoints, setEndpoints] = useState<MonitoredEndpoint[]>(isAwsMode ? [] : initialEndpoints);
  const [checks, setChecks] = useState<CheckResult[]>(isAwsMode ? [] : initialChecks);
  const [form, setForm] = useState<CreateEndpointInput>(initialForm);
  const [notice, setNotice] = useState(
    isAwsMode
      ? requiresAuthentication ? 'Restoring your secure session...' : 'Loading monitors from AWS...'
      : 'Local fallback mode: no AWS resources are being used.',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runningEndpointIds, setRunningEndpointIds] = useState<ReadonlySet<string>>(new Set());
  const [runningPerformanceIds, setRunningPerformanceIds] = useState<ReadonlySet<string>>(new Set());
  const [analytics, setAnalytics] = useState<AnalyticsOverview | undefined>();
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [performanceHistory, setPerformanceHistory] = useState<Record<string, PerformanceResult[]>>({});
  const [incidentHistory, setIncidentHistory] = useState<Record<string, Incident[]>>({});
  const [expandedIncidentIds, setExpandedIncidentIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedActionIds, setExpandedActionIds] = useState<ReadonlySet<string>>(new Set());
  const [editingEndpointId, setEditingEndpointId] = useState<string>();
  const [editForm, setEditForm] = useState<UpdateEndpointInput>({});
  const [authStatus, setAuthStatus] = useState<'loading' | 'signed-out' | 'authenticated'>(requiresAuthentication ? 'loading' : 'authenticated');
  const [authSession, setAuthSession] = useState<JwtSession>();
  const [authStage, setAuthStage] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [discordWebhookConfigured, setDiscordWebhookConfigured] = useState(false);
  const [isDiscordBusy, setIsDiscordBusy] = useState(false);

  useEffect(() => {
    if (!jwtAuth || !apiClient) {
      return;
    }

    let active = true;
    const session = jwtAuth.restoreSession();
    if (session) {
      apiClient.setAccessToken(session.token);
      setAuthSession(session);
      setAuthStatus('authenticated');
      setNotice(`Signed in as ${session.email}.`);
    } else {
      setAuthStatus('signed-out');
      setNotice('Sign in to access your monitored endpoints.');
    }

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!apiClient) {
      return;
    }
    if (jwtAuth && authStatus !== 'authenticated') {
      return;
    }

    let active = true;
    apiClient.getDiscordWebhookSettings()
      .then((settings) => {
        if (active) setDiscordWebhookConfigured(settings.configured);
      })
      .catch(() => undefined);

    apiClient.listEndpoints()
      .then(async (items) => {
        if (active) {
          setEndpoints(items);
          setChecks(items.flatMap((endpoint) => endpoint.latestCheck ? [endpoint.latestCheck] : []));
          setNotice(`Connected to AWS. Loaded ${items.length} monitored endpoints.`);
        }
        const history = await Promise.all(items.map(async (endpoint) => {
          try {
            return [endpoint.id, await apiClient.listPerformance(endpoint.id)] as const;
          } catch {
            return [endpoint.id, []] as const;
          }
        }));
        if (active) {
          setPerformanceHistory(Object.fromEntries(history));
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
  }, [authStatus]);

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

  async function submitSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jwtAuth) return;
    setIsAuthBusy(true);
    try {
      const session = await jwtAuth.signIn(authEmail.trim(), authPassword);
      jwtAuth.persist(session);
      apiClient?.setAccessToken(session.token);
      setAuthSession(session);
      setAuthStatus('authenticated');
      setAuthPassword('');
      setNotice(`Signed in as ${session.email}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Sign in failed.');
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function submitSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jwtAuth) return;
    setIsAuthBusy(true);
    try {
      const session = await jwtAuth.register(authEmail.trim(), authPassword);
      jwtAuth.persist(session);
      apiClient?.setAccessToken(session.token);
      setAuthSession(session);
      setAuthStatus('authenticated');
      setAuthPassword('');
      setNotice(`Account created. Signed in as ${session.email}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Sign up failed.');
    } finally {
      setIsAuthBusy(false);
    }
  }

  function signOut() {
    jwtAuth?.signOut();
    apiClient?.setAccessToken(undefined);
    setAuthSession(undefined);
    setAuthStatus(requiresAuthentication ? 'signed-out' : 'authenticated');
    setEndpoints([]);
    setChecks([]);
    setAnalytics(undefined);
    setPerformanceHistory({});
    setIncidentHistory({});
    setDiscordWebhookUrl('');
    setDiscordWebhookConfigured(false);
    setNotice('You have been signed out.');
  }

  async function saveDiscordWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiClient) {
      setNotice('Discord notifications require the AWS-connected dashboard.');
      return;
    }

    setIsDiscordBusy(true);
    try {
      const settings = await apiClient.saveDiscordWebhook(discordWebhookUrl);
      setDiscordWebhookConfigured(settings.configured);
      setDiscordWebhookUrl('');
      setNotice('Your Discord webhook was saved. New outage and recovery alerts will use it.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The Discord webhook could not be saved.');
    } finally {
      setIsDiscordBusy(false);
    }
  }

  async function removeDiscordWebhook() {
    if (!apiClient || !window.confirm('Disable Discord notifications for your account?')) return;

    setIsDiscordBusy(true);
    try {
      const settings = await apiClient.removeDiscordWebhook();
      setDiscordWebhookConfigured(settings.configured);
      setDiscordWebhookUrl('');
      setNotice('Discord notifications were disabled for your account.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The Discord webhook could not be removed.');
    } finally {
      setIsDiscordBusy(false);
    }
  }

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

  async function runPerformance(endpointId: string) {
    const endpoint = endpoints.find((candidate) => candidate.id === endpointId);
    if (!apiClient) {
      setNotice('PageSpeed checks require the AWS-connected dashboard.');
      return;
    }

    setRunningPerformanceIds((current) => new Set(current).add(endpointId));
    try {
      const result = await apiClient.runPerformance(endpointId);
      setPerformanceHistory((current) => ({
        ...current,
        [endpointId]: [result, ...(current[endpointId] ?? []).filter((item) => item.measuredAt !== result.measuredAt)],
      }));
      setNotice(
        `${endpoint?.name ?? endpointId}: PageSpeed mobile scores — ` +
        `performance ${result.performanceScore}, accessibility ${result.accessibilityScore}, ` +
        `best practices ${result.bestPracticesScore}, SEO ${result.seoScore}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The PageSpeed check could not be completed.');
    } finally {
      setRunningPerformanceIds((current) => {
        const next = new Set(current);
        next.delete(endpointId);
        return next;
      });
    }
  }

  async function loadAnalytics() {
    if (!apiClient) {
      setNotice('Analytics requires the AWS-connected dashboard.');
      return;
    }

    setIsLoadingAnalytics(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 86_400_000);
      const result = await apiClient.getAnalyticsOverview({ from: from.toISOString(), to: to.toISOString() });
      setAnalytics(result);
      setNotice(`Analytics loaded for the last 24 hours: ${result.totalChecks} checks, ${result.incidentCount} incidents.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Analytics could not be loaded.');
    } finally {
      setIsLoadingAnalytics(false);
    }
  }

  function beginEdit(endpoint: MonitoredEndpoint) {
    setEditingEndpointId(endpoint.id);
    setEditForm({
      name: endpoint.name,
      url: endpoint.url,
      intervalMinutes: endpoint.intervalMinutes,
      enabled: endpoint.enabled,
    });
  }

  async function saveEndpointEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEndpointId) return;

    const endpointId = editingEndpointId;
    try {
      if (apiClient) {
        const updated = await apiClient.updateEndpoint(endpointId, editForm);
        setEndpoints((current) => current.map((endpoint) => endpoint.id === endpointId ? updated : endpoint));
        setNotice(`${updated.name} was updated and its recurring schedule was synchronized.`);
      } else {
        setEndpoints((current) => current.map((endpoint) => endpoint.id === endpointId ? {
          ...endpoint,
          name: editForm.name?.trim() || endpoint.name,
          url: editForm.url ? new URL(editForm.url).toString() : endpoint.url,
          intervalMinutes: editForm.intervalMinutes ?? endpoint.intervalMinutes,
          enabled: editForm.enabled ?? endpoint.enabled,
          updatedAt: new Date().toISOString(),
        } : endpoint));
        setNotice('Endpoint settings updated in local fallback mode.');
      }
      setEditingEndpointId(undefined);
      setEditForm({});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The endpoint could not be updated.');
    }
  }

  async function toggleEndpoint(endpoint: MonitoredEndpoint) {
    const enabled = !endpoint.enabled;
    try {
      if (apiClient) {
        const updated = await apiClient.updateEndpoint(endpoint.id, { enabled });
        setEndpoints((current) => current.map((candidate) => candidate.id === endpoint.id ? updated : candidate));
      } else {
        setEndpoints((current) => current.map((candidate) => candidate.id === endpoint.id
          ? { ...candidate, enabled, updatedAt: new Date().toISOString() }
          : candidate));
      }
      setNotice(`${endpoint.name} is now ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The endpoint state could not be changed.');
    }
  }

  async function removeEndpoint(endpoint: MonitoredEndpoint) {
    if (!window.confirm(`Delete ${endpoint.name}? This also removes its recurring schedule.`)) return;

    try {
      if (apiClient) {
        await apiClient.deleteEndpoint(endpoint.id);
      }
      setEndpoints((current) => current.filter((candidate) => candidate.id !== endpoint.id));
      setChecks((current) => current.filter((check) => check.endpointId !== endpoint.id));
      setIncidentHistory((current) => {
        const next = { ...current };
        delete next[endpoint.id];
        return next;
      });
      setNotice(`${endpoint.name} was deleted.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The endpoint could not be deleted.');
    }
  }

  async function loadIncidents(endpointId: string) {
    if (!apiClient) {
      setExpandedIncidentIds((current) => {
        const next = new Set(current);
        if (next.has(endpointId)) next.delete(endpointId); else next.add(endpointId);
        return next;
      });
      setNotice('Incident history is available after connecting the dashboard to AWS.');
      return;
    }

    try {
      const items = await apiClient.listIncidents(endpointId);
      setIncidentHistory((current) => ({ ...current, [endpointId]: items }));
      setExpandedIncidentIds((current) => new Set(current).add(endpointId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Incident history could not be loaded.');
    }
  }

  function toggleActions(endpointId: string) {
    setExpandedActionIds((current) => {
      const next = new Set(current);
      if (next.has(endpointId)) next.delete(endpointId); else next.add(endpointId);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <main id="top">
        <header className="topbar">
          <div>
            <span className="eyebrow">{formatCurrentDate()}</span>
            <h1>Deployment overview</h1>
          </div>
          <div className="topbar-actions">
            <span className="environment"><i /> {isAwsMode ? 'AWS live environment' : 'Local fallback environment'}</span>
            {requiresAuthentication && authSession && (
              <button className="button-secondary" type="button" onClick={signOut}>Sign out</button>
            )}
          </div>
        </header>

        <div className="notice" role="status">{notice}</div>

        {requiresAuthentication && authStatus !== 'authenticated' ? (
          <section className="auth-panel panel" aria-labelledby="auth-title">
            <span className="eyebrow">Protected workspace</span>
            <h2 id="auth-title">
            {authStatus === 'loading' ? 'Restoring secure session' : authStage === 'sign-up' ? 'Create your account' : 'Sign in to CloudSentinel'}
            </h2>
            {authStatus === 'loading' ? (
              <p className="empty-state">Checking for an existing JWT session...</p>
            ) : (
              <form className="auth-form" onSubmit={(event) => void (authStage === 'sign-up' ? submitSignUp(event) : submitSignIn(event))}>
                <label>
                  Email
                  <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" required />
                </label>
                <label>
                  Password
                  <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} minLength={12} autoComplete={authStage === 'sign-up' ? 'new-password' : 'current-password'} required />
                </label>
                <button className="button-primary" disabled={isAuthBusy} type="submit">
                  {isAuthBusy ? 'Working...' : authStage === 'sign-up' ? 'Create account' : 'Sign in'}
                </button>
                <button className="auth-link" type="button" onClick={() => setAuthStage(authStage === 'sign-up' ? 'sign-in' : 'sign-up')}>
                  {authStage === 'sign-up' ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
                </button>
              </form>
            )}
            <small className="auth-note">Accounts are stored in DynamoDB and API requests use a signed 24-hour JWT. No email confirmation is required.</small>
          </section>
        ) : (
          <>
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
                const isPerformanceRunning = runningPerformanceIds.has(endpoint.id);
                return <div className="endpoint-item" key={endpoint.id}>
                  <div className="endpoint-row">
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
                    <div className="endpoint-actions">
                      <button className="button-secondary" disabled={isRunning} type="button" onClick={() => void runCheck(endpoint.id)}>
                        {isRunning ? 'Checking...' : 'Run check'}
                      </button>
                      <button className="button-secondary" disabled={isPerformanceRunning} type="button" onClick={() => void runPerformance(endpoint.id)}>
                        {isPerformanceRunning ? 'Measuring...' : 'PageSpeed'}
                      </button>
                      <button
                        className="button-secondary button-manage"
                        type="button"
                        aria-expanded={expandedActionIds.has(endpoint.id)}
                        onClick={() => toggleActions(endpoint.id)}
                      >
                        {expandedActionIds.has(endpoint.id) ? 'Close' : 'Manage'}
                      </button>
                    </div>
                  </div>
                  {expandedActionIds.has(endpoint.id) && (
                    <div className="endpoint-manage-actions">
                      <button className="button-secondary" type="button" onClick={() => beginEdit(endpoint)}>Edit</button>
                      <button className="button-secondary" type="button" onClick={() => void toggleEndpoint(endpoint)}>
                        {endpoint.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="button-secondary button-danger" type="button" onClick={() => void removeEndpoint(endpoint)}>Delete</button>
                      <button className="button-secondary" type="button" onClick={() => void loadIncidents(endpoint.id)}>
                        {expandedIncidentIds.has(endpoint.id) ? 'Hide incidents' : 'Incidents'}
                      </button>
                    </div>
                  )}
                  {editingEndpointId === endpoint.id && (
                    <form className="edit-panel" onSubmit={(event) => void saveEndpointEdit(event)}>
                      <label>
                        Name
                        <input required maxLength={80} value={editForm.name ?? ''} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
                      </label>
                      <label>
                        URL
                        <input required type="url" value={editForm.url ?? ''} onChange={(event) => setEditForm({ ...editForm, url: event.target.value })} />
                      </label>
                      <label>
                        Interval
                        <select value={editForm.intervalMinutes ?? endpoint.intervalMinutes} onChange={(event) => setEditForm({ ...editForm, intervalMinutes: Number(event.target.value) as MonitoringIntervalMinutes })}>
                          {monitoringIntervals.map((interval) => <option key={interval} value={interval}>Every {interval} minutes</option>)}
                        </select>
                      </label>
                      <button className="button-secondary" type="submit">Save changes</button>
                      <button className="button-secondary" type="button" onClick={() => setEditingEndpointId(undefined)}>Cancel</button>
                    </form>
                  )}
                  {expandedIncidentIds.has(endpoint.id) && (
                    <div className="incident-list" aria-label={`${endpoint.name} incident history`}>
                      {(incidentHistory[endpoint.id] ?? []).length === 0
                        ? <span className="empty-inline">No persisted incidents.</span>
                        : (incidentHistory[endpoint.id] ?? []).map((incident) => (
                          <div className="incident-row" key={incident.id}>
                            <strong>{incident.status}</strong>
                            <span>Opened {formatTime(incident.openedAt)}</span>
                            <span>{incident.recoveredAt ? `Recovered ${formatTime(incident.recoveredAt)}` : 'Still open'}</span>
                          </div>
                        ))}
                    </div>
                  )}
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

        <section className="panel notification-panel" aria-labelledby="notification-title">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Private account setting</span>
              <h2 id="notification-title">Discord notifications</h2>
            </div>
            <span className={`count-pill ${discordWebhookConfigured ? 'configured-pill' : ''}`}>
              {discordWebhookConfigured ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <p className="settings-copy">
            Add a Discord channel webhook to receive outage and recovery alerts for your monitors. The URL is stored securely and is never returned to the browser.
          </p>
          <form className="notification-form" onSubmit={(event) => void saveDiscordWebhook(event)}>
            <label>
              Discord webhook URL
              <input
                required
                type="url"
                placeholder="https://discord.com/api/webhooks/..."
                value={discordWebhookUrl}
                onChange={(event) => setDiscordWebhookUrl(event.target.value)}
              />
            </label>
            <div className="notification-actions">
              <button className="button-primary" type="submit" disabled={isDiscordBusy || !apiClient}>
                {isDiscordBusy ? 'Saving...' : discordWebhookConfigured ? 'Replace webhook' : 'Save webhook'}
              </button>
              {discordWebhookConfigured && (
                <button className="button-secondary button-danger" type="button" disabled={isDiscordBusy} onClick={() => void removeDiscordWebhook()}>
                  Remove webhook
                </button>
              )}
            </div>
          </form>
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

          <article id="analytics" className="panel analytics-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Last 24 hours</span>
                <h2>Historical analytics</h2>
              </div>
              <button className="button-secondary" type="button" disabled={isLoadingAnalytics} onClick={() => void loadAnalytics()}>
                {isLoadingAnalytics ? 'Loading...' : 'Load analytics'}
              </button>
            </div>
            {!analytics && <p className="empty-state">Load Athena-backed history when the analytics resources are deployed.</p>}
              {analytics && (
                <>
                  <div className="analytics-grid" aria-label="Historical analytics summary">
                    <div><strong>{analytics.uptimePercent === null ? '--' : `${analytics.uptimePercent}%`}</strong><span>Uptime</span></div>
                    <div><strong>{analytics.totalChecks}</strong><span>Checks</span></div>
                    <div><strong>{analytics.averageResponseTimeMs === null ? '--' : `${analytics.averageResponseTimeMs} ms`}</strong><span>Avg response</span></div>
                    <div><strong>{analytics.incidentCount}</strong><span>Incidents</span></div>
                  </div>
                  <div className="analytics-breakdown" aria-label="Up and down check breakdown">
                    <div className="analytics-breakdown-labels"><span>UP {analytics.upChecks}</span><span>DOWN {analytics.downChecks}</span></div>
                    <div className="analytics-bar">
                      <span className="analytics-bar-up" style={{ width: `${analytics.totalChecks ? (analytics.upChecks / analytics.totalChecks) * 100 : 0}%` }} />
                      <span className="analytics-bar-down" style={{ width: `${analytics.totalChecks ? (analytics.downChecks / analytics.totalChecks) * 100 : 0}%` }} />
                    </div>
                  </div>
                </>
            )}
          </article>

          <article id="performance" className="panel performance-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Persisted measurements</span>
                <h2>PageSpeed history</h2>
              </div>
              <span className="count-pill">Mobile</span>
            </div>
            {Object.values(performanceHistory).every((items) => items.length === 0) && (
              <p className="empty-state">Run PageSpeed beside an endpoint to build its score history.</p>
            )}
            <div className="performance-list" aria-label="Persisted PageSpeed measurements">
              {endpoints.flatMap((endpoint) => (performanceHistory[endpoint.id] ?? []).slice(0, 3).map((result) => (
                <div className="performance-row" key={`${endpoint.id}-${result.measuredAt}`}>
                  <div>
                    <strong>{endpoint.name}</strong>
                    <small>{formatTime(result.measuredAt)}</small>
                  </div>
                  <div className="score-bars">
                    {[
                      ['Performance', result.performanceScore],
                      ['Accessibility', result.accessibilityScore],
                      ['Best practices', result.bestPracticesScore],
                      ['SEO', result.seoScore],
                    ].map(([label, value]) => (
                      <span className="score-bar" key={label as string}>
                        <em>{label}</em>
                        <i><b style={{ width: `${value}%` }} /></i>
                        <strong>{value}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )))}
            </div>
          </article>

          <article id="architecture" className="panel architecture-panel">
            <div>
                <span className="eyebrow">Deployed AWS flow</span>
                <h2>From dashboard to evidence</h2>
                <p>Client actions now reach the live API, monitoring worker, persisted history, analytics, and performance services.</p>
              </div>
              <div className="flow" aria-label="Deployed AWS request flow">
              <span>React</span><i>1</i><span>API Gateway</span><i>2</i><span>Lambda</span><i>3</i><span>DynamoDB</span><i>4</i><span>ECS</span><i>5</i><span>Athena</span>
              </div>
          </article>
        </section>
          </>
        )}
      </main>
    </div>
  );
}
