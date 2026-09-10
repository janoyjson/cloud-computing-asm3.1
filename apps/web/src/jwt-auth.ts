export interface JwtSession {
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
}

interface AuthResponse {
  token: string;
  expiresAt: string;
  user: { id: string; email: string };
}

interface ErrorResponse {
  error?: { message?: string };
}

const storageKey = 'cloudsentinel.jwt.session';

export class JwtAuthClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  public constructor(baseUrl: string, fetchClient: typeof fetch = window.fetch.bind(window)) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#fetch = fetchClient;
  }

  public async signIn(email: string, password: string): Promise<JwtSession> {
    return this.#request('/v1/auth/login', { email, password });
  }

  public async register(email: string, password: string): Promise<JwtSession> {
    return this.#request('/v1/auth/register', { email, password });
  }

  public restoreSession(): JwtSession | undefined {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return undefined;
      const session = JSON.parse(raw) as JwtSession;
      if (!session.token || !session.userId || new Date(session.expiresAt).getTime() <= Date.now()) {
        this.signOut();
        return undefined;
      }
      return session;
    } catch {
      this.signOut();
      return undefined;
    }
  }

  public persist(session: JwtSession): void {
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  }

  public signOut(): void {
    window.localStorage.removeItem(storageKey);
  }

  async #request(path: string, body: { email: string; password: string }): Promise<JwtSession> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as AuthResponse & ErrorResponse;
    if (!response.ok) throw new Error(payload.error?.message ?? `Authentication failed with status ${response.status}.`);
    return { userId: payload.user.id, email: payload.user.email, token: payload.token, expiresAt: payload.expiresAt };
  }
}
