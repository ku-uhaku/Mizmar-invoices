import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { AppError } from '../app-error';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestWithContext } from '../../tenancy/request-context';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Replay protection for the mobile outbox.
 *
 * A phone that loses signal mid-request cannot know whether the stock
 * adjustment landed, so it retries. Without this, the retry would deduct the
 * damaged goods a second time. The first response for a given key is stored and
 * replayed verbatim, so a retry is always a no-op that still looks successful
 * to the caller.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(host: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = host.switchToHttp().getRequest<FastifyRequest & RequestWithContext>();

    const header = request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;

    if (!key || !MUTATING.has(request.method) || !request.ctx) {
      return next.handle();
    }

    const requestHash = hashRequest(request.method, request.url, request.body);
    const ctx = request.ctx;

    return from(this.prisma.idempotencyKey.findUnique({ where: { key } })).pipe(
      switchMap((existing) => {
        if (existing) {
          // Same key, different request: the client has a bug, and silently
          // replaying the old answer would hide it.
          if (existing.requestHash !== requestHash) {
            throw AppError.conflict(
              'IDEMPOTENCY_KEY_REUSED',
              'This idempotency key was already used for a different request',
            );
          }
          return of(existing.responseBody ?? { replayed: true });
        }

        return next.handle().pipe(
          tap((body) => {
            // Recorded only after the handler succeeds, so a failed attempt can
            // be retried with the same key rather than being poisoned forever.
            void this.prisma.idempotencyKey
              .create({
                data: {
                  key,
                  organizationId: ctx.organizationId,
                  userId: ctx.userId,
                  endpoint: `${request.method} ${request.url.split('?')[0]}`,
                  requestHash,
                  responseStatus: 200,
                  responseBody: (body ?? null) as never,
                },
              })
              .catch(() => undefined);
          }),
        );
      }),
    );
  }
}

function hashRequest(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}|${url.split('?')[0]}|${JSON.stringify(body ?? null)}`)
    .digest('hex');
}
