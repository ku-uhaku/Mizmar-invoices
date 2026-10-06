import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * An error with a machine-readable code.
 *
 * The web and mobile clients branch on `code`, not on message text, so error
 * handling survives translation and copy changes. Codes mirror the ones
 * `@mizmar/core` throws (QUANTITY_EXCEEDS_REMAINDER, ILLEGAL_TARGET, ...).
 */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super({ statusCode: status, code, message, details }, status);
  }

  static notFound(entity: string, id?: string): AppError {
    return new AppError(
      'NOT_FOUND',
      id ? `${entity} ${id} was not found` : `${entity} was not found`,
      HttpStatus.NOT_FOUND,
    );
  }

  static forbidden(message = 'You are not allowed to do that'): AppError {
    return new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
  }

  static conflict(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }

  static unprocessable(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): AppError {
    return new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  static badRequest(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }
}
