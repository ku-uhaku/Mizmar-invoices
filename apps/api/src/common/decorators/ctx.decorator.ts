import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { AppError } from '../app-error';
import type { RequestContext, RequestWithContext } from '../../tenancy/request-context';

/** Inject the authenticated request context. Requires the auth guard. */
export const Ctx = createParamDecorator((_data: unknown, host: ExecutionContext): RequestContext => {
  const request = host.switchToHttp().getRequest<RequestWithContext>();
  if (!request.ctx) throw AppError.unauthorized();
  return request.ctx;
});
