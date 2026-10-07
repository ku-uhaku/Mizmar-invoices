import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Observable, tap } from 'rxjs';
import type { RequestWithContext } from '../tenancy/request-context';
import { deriveAudit, isLoginRoute, shouldAudit } from './audit.derive';
import { sanitize, scalarSummary } from './audit.sanitize';
import { AuditService } from './audit.service';

type AuditedRequest = FastifyRequest & RequestWithContext;

/**
 * Records every successful mutating request in the audit log.
 *
 * Registered after the idempotency interceptor in AppModule, so a replayed
 * request (which short-circuits there) never reaches this and is not logged
 * twice. Everything here is wrapped: a failure to audit must never alter or
 * fail the response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  intercept(host: ExecutionContext, next: CallHandler): Observable<unknown> {
    let request: AuditedRequest;
    let pattern: string;
    try {
      if (host.getType() !== 'http') return next.handle();
      request = host.switchToHttp().getRequest<AuditedRequest>();
      pattern = routePattern(request);
      const login = isLoginRoute(request.method, pattern);
      if (!login && !shouldAudit(request.method, pattern)) return next.handle();
      if (login) return this.interceptLogin(request, next);
      if (!request.ctx) return next.handle();
    } catch (error) {
      this.logger.error(`audit interceptor setup failed: ${describe(error)}`);
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseBody) => {
        try {
          const ctx = request.ctx;
          if (!ctx) return;
          const derived = deriveAudit({
            method: request.method,
            pattern,
            params: request.params as Record<string, unknown>,
            responseBody,
          });
          const reply = host.switchToHttp().getResponse<FastifyReply>();
          void this.audit
            .record({
              ctx,
              action: derived.action,
              entityType: derived.entityType,
              entityId: derived.entityId,
              after: scalarSummary(responseBody),
              meta: {
                method: request.method,
                route: pattern,
                path: request.url.split('?')[0],
                status: reply?.statusCode,
                requestId: String(request.id ?? request.headers['x-request-id'] ?? ''),
                body: sanitize(request.body),
              },
              ipAddress: request.ip,
              userAgent: request.headers['user-agent'],
            })
            .catch(() => undefined);
        } catch (error) {
          this.logger.error(`audit interceptor failed: ${describe(error)}`);
        }
      }),
    );
  }

  /** Login is public (no context): resolve the account from the submitted email. */
  private interceptLogin(request: AuditedRequest, next: CallHandler): Observable<unknown> {
    const email = (request.body as { email?: unknown } | undefined)?.email;
    const emit = (success: boolean, reason?: string) => {
      try {
        if (typeof email !== 'string') return;
        void this.audit
          .recordLogin({
            email,
            success,
            reason,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          })
          .catch(() => undefined);
      } catch (error) {
        this.logger.error(`audit interceptor failed: ${describe(error)}`);
      }
    };
    return next.handle().pipe(
      tap({
        next: () => emit(true),
        error: (error: unknown) =>
          emit(false, error instanceof Error ? error.message.slice(0, 200) : undefined),
      }),
    );
  }
}

function routePattern(request: FastifyRequest): string {
  const withRouteOptions = request as FastifyRequest & {
    routeOptions?: { url?: string };
    routerPath?: string;
  };
  return (
    withRouteOptions.routeOptions?.url ?? withRouteOptions.routerPath ?? request.url.split('?')[0] ?? ''
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
