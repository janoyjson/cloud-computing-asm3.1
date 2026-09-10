import { describe, expect, it } from 'vitest';

import { hashPassword, issueJwt, verifyJwt, verifyPassword, type AuthUser } from './auth.js';

const user: AuthUser = {
  id: 'user#demo',
  email: 'demo@example.com',
  passwordHash: '',
  createdAt: '2026-09-09T00:00:00.000Z',
};

describe('application JWT authentication', () => {
  it('hashes and verifies passwords without storing the clear text', () => {
    const encoded = hashPassword('CloudSentinelDemo!01');

    expect(encoded).not.toContain('CloudSentinelDemo!01');
    expect(verifyPassword('CloudSentinelDemo!01', encoded)).toBe(true);
    expect(verifyPassword('wrong-password', encoded)).toBe(false);
  });

  it('issues and verifies an expiring signed token', () => {
    const session = issueJwt({ ...user, passwordHash: hashPassword('password') }, 'test-secret', 1_000);
    expect(verifyJwt(session.token, 'test-secret', 1_001)).toMatchObject({ sub: user.id, email: user.email, exp: 87_400 });
    expect(verifyJwt(session.token, 'wrong-secret', 1_001)).toBeUndefined();
    expect(verifyJwt(session.token, 'test-secret', 87_400)).toBeUndefined();
  });
});
