import { describe, expect, it, vi } from 'vitest';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { deriveAudit, shouldAudit } from './audit.derive';
import { AuditInterceptor } from './audit.interceptor';
import { REDACTED, sanitize } from './audit.sanitize';
import type { AuditService } from './audit.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('sanitize', () => {
  it('redacts secrets at any depth', () => {
    const out = sanitize({
      email: 'a@b.c',
      password: 'hunter2',
      nested: { passwordHash: 'x', refreshToken: 'y', ok: 1 },
      list: [{ apiKey: 'k' }],
    }) as any;
    expect(out.password).toBe(REDACTED);
    expect(out.nested.passwordHash).toBe(REDACTED);
    expect(out.nested.refreshToken).toBe(REDACTED);
    expect(out.nested.ok).toBe(1);
    expect(out.list[0].apiKey).toBe(REDACTED);
    expect(out.email).toBe('a@b.c');
  });

  it('truncates long strings, big arrays and oversized payloads', () => {
    const out = sanitize({ s: 'x'.repeat(2000), a: Array.from({ length: 100 }, (_, i) => i) }) as any;
    expect(out.s.length).toBeLessThan(600);
    expect(out.a).toHaveLength(21);
    const huge = sanitize(
      Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 'y'.repeat(400)])),
    ) as any;
    expect(huge._truncated).toBe(true);
  });

  it('survives cycles, bigint and dates', () => {
    const a: any = { n: BigInt(1), d: new Date('2026-01-01T00:00:00Z') };
    a.self = a;
    const out = sanitize(a) as any;
    expect(out.n).toBe('1');
    expect(out.d).toBe('2026-01-01T00:00:00.000Z');
    expect(out.self).toBe('[circular]');
  });
});

describe('deriveAudit', () => {
  const id = '11111111-1111-1111-1111-111111111111';

  it('names document verbs', () => {
    expect(
      deriveAudit({ method: 'POST', pattern: '/api/v1/documents/:id/validate', params: { id } }),
    ).toEqual({ action: 'documents.validate', entityType: 'Document', entityId: id });
    expect(
      deriveAudit({ method: 'POST', pattern: '/api/v1/documents/:id/cancel', params: { id } }).action,
    ).toBe('documents.cancel');
  });

  it('uses the response id for creations and conversions', () => {
    expect(
      deriveAudit({ method: 'POST', pattern: '/api/v1/documents/convert', responseBody: { id } }),
    ).toEqual({ action: 'documents.convert', entityType: 'Document', entityId: id });
    expect(
      deriveAudit({ method: 'POST', pattern: '/api/v1/contacts', responseBody: { id } }),
    ).toEqual({ action: 'contacts.create', entityType: 'Contact', entityId: id });
  });

  it('maps methods to verbs and nested resources', () => {
    expect(
      deriveAudit({ method: 'PATCH', pattern: '/api/v1/contacts/:id', params: { id } }).action,
    ).toBe('contacts.update');
    expect(
      deriveAudit({ method: 'DELETE', pattern: '/api/v1/payments/:id', params: { id } }).action,
    ).toBe('payments.delete');
    const r = deriveAudit({
      method: 'PATCH',
      pattern: '/api/v1/companies/:id/number-sequences/:sequenceId',
      params: { id, sequenceId: 'seq' },
    });
    expect(r.entityType).toBe('NumberSequence');
    expect(r.entityId).toBe('seq');
  });

  it('filters what is audited', () => {
    expect(shouldAudit('GET', '/api/v1/documents')).toBe(false);
    expect(shouldAudit('POST', '/api/v1/auth/refresh')).toBe(false);
    expect(shouldAudit('POST', '/api/v1/documents/:id/validate/preview')).toBe(false);
    expect(shouldAudit('POST', '/api/v1/documents/:id/validate')).toBe(true);
  });
});

function host(request: object): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
  } as unknown as ExecutionContext;
}

describe('AuditInterceptor', () => {
  const request = {
    method: 'POST',
    url: '/api/v1/documents/abc/validate?x=1',
    routeOptions: { url: '/api/v1/documents/:id/validate' },
    params: { id: 'abc' },
    body: { password: 'p', note: 'n' },
    headers: {},
    ip: '1.1.1.1',
    id: 'req-1',
    ctx: { organizationId: 'o', userId: 'u', membershipId: 'm', companyId: 'c' },
  };

  it('records and passes the response through untouched', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor({ record } as unknown as AuditService);
    const next: CallHandler = { handle: () => of({ id: 'abc', number: 'FA-1' }) };
    const out = await lastValueFrom(interceptor.intercept(host(request), next));
    expect(out).toEqual({ id: 'abc', number: 'FA-1' });
    expect(record).toHaveBeenCalledOnce();
    const arg = record.mock.calls[0]![0];
    expect(arg.action).toBe('documents.validate');
    expect(arg.meta.body.password).toBe(REDACTED);
  });

  it('never breaks the request when auditing throws or rejects', async () => {
    const next: CallHandler = { handle: () => of({ ok: true }) };
    const sync = new AuditInterceptor({
      record: () => {
        throw new Error('boom');
      },
    } as unknown as AuditService);
    await expect(lastValueFrom(sync.intercept(host(request), next))).resolves.toEqual({ ok: true });

    const rejecting = new AuditInterceptor({
      record: () => Promise.reject(new Error('db down')),
    } as unknown as AuditService);
    await expect(lastValueFrom(rejecting.intercept(host(request), next))).resolves.toEqual({
      ok: true,
    });
  });

  it('does not audit reads, and propagates handler errors', async () => {
    const record = vi.fn();
    const interceptor = new AuditInterceptor({ record } as unknown as AuditService);
    await lastValueFrom(
      interceptor.intercept(host({ ...request, method: 'GET' }), { handle: () => of(1) }),
    );
    await expect(
      lastValueFrom(
        interceptor.intercept(host(request), { handle: () => throwError(() => new Error('nope')) }),
      ),
    ).rejects.toThrow('nope');
    expect(record).not.toHaveBeenCalled();
  });

  it('records login failures and still propagates the error', async () => {
    const recordLogin = vi.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor({ recordLogin } as unknown as AuditService);
    const req = {
      ...request,
      url: '/api/v1/auth/login',
      routeOptions: { url: '/api/v1/auth/login' },
      body: { email: 'a@b.c', password: 'x' },
      ctx: undefined,
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(host(req), { handle: () => throwError(() => new Error('bad')) }),
      ),
    ).rejects.toThrow('bad');
    expect(recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.c', success: false }),
    );
  });
});
