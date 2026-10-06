import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConversionError, IllegalTransitionError } from '@mizmar/core';
import type { FastifyReply } from 'fastify';

/**
 * Turns every throw into the single error envelope the contract declares:
 * `{ statusCode, code, message, details? }`.
 *
 * Domain errors from `@mizmar/core` are translated here rather than wrapped at
 * each call site, so a service can just throw the domain error and trust that
 * the client sees a usable code.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${body.code}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    void reply.status(body.statusCode).send(body);
  }

  private toBody(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    // Conversion and state-machine violations are the user's doing, not a bug.
    if (exception instanceof ConversionError) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof IllegalTransitionError) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'ILLEGAL_TRANSITION',
        message: exception.message,
        details: { from: exception.from, to: exception.to },
      };
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();

      if (typeof response === 'object' && response !== null && 'code' in response) {
        return { ...(response as Record<string, unknown>), statusCode: status } as never;
      }

      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);

      return {
        statusCode: status,
        code: defaultCodeForStatus(status),
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return mapPrismaError(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
    };
  }
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY';
    default:
      return 'ERROR';
  }
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  const target = (error.meta?.target as string[] | string | undefined) ?? undefined;

  switch (error.code) {
    case 'P2002':
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'DUPLICATE',
        message: 'A record with these details already exists',
        details: { fields: target },
      };
    case 'P2003':
    case 'P2025':
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'A referenced record was not found',
      };
    case 'P2014':
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'REFERENCED',
        message: 'This record is referenced elsewhere and cannot be removed',
      };
    default:
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: `DB_${error.code}`,
        message: 'Database error',
      };
  }
}
