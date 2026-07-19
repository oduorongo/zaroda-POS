import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger } from 'nestjs-pino';

/**
 * A caught HttpException (NotFoundException, BadRequestException, etc.)
 * already carries a client-safe message - pass it through unchanged, same
 * response shape callers already depend on. Anything else is unexpected
 * (a bug, a driver error) - log the full stack server-side but return a
 * generic 500 to the client, since leaking a Prisma/driver error message
 * to a POS terminal could expose schema details or connection info.
 * Either way this is the one place every unhandled error passes through,
 * so it's also the one place that guarantees an error is never silently
 * swallowed without a log line carrying the request's correlation id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    this.logger.error(
      {
        requestId: (request as unknown as { id?: string }).id,
        method: request.method,
        path: request.url,
        statusCode: status,
        err: exception,
      },
      isHttpException ? 'Handled exception' : 'Unhandled exception',
    );

    response.status(status).json(body);
  }
}
