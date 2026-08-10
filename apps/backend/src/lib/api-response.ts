import { NextResponse } from 'next/server';
import { ApiError } from './api-error';

interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
}

interface ApiResponseOptions {
  status?: number;
  headers?: Record<string, string>;
}

export class ApiResponse {
  static success<T>(data: T, message?: string, options?: ApiResponseOptions) {
    return NextResponse.json(
      {
        success: true,
        message,
        data,
      },
      {
        status: options?.status || 200,
        headers: options?.headers,
      }
    );
  }

  static paginated<T>(data: T[], meta: PaginationMeta, message?: string, options?: ApiResponseOptions) {
    return NextResponse.json(
      {
        success: true,
        message,
        data,
        meta,
      },
      {
        status: options?.status || 200,
        headers: options?.headers,
      }
    );
  }

  static error(error: Error | ApiError | unknown, defaultMessage = 'Internal Server Error') {
    let statusCode = 500;
    let message = defaultMessage;
    let code = 'INTERNAL_SERVER_ERROR';
    let metadata = undefined;

    if (error instanceof ApiError) {
      statusCode = error.statusCode;
      message = error.message;
      code = error.code || code;
      metadata = error.metadata;
    } else if (error instanceof Error) {
      // Handle Prisma/Zod or other mapped errors here
      message = error.message;
      if (message.startsWith('NOT_FOUND:')) {
        statusCode = 404;
        code = 'NOT_FOUND';
        message = message.replace('NOT_FOUND:', '').trim();
      } else if (message.startsWith('FORBIDDEN:')) {
        statusCode = 403;
        code = 'FORBIDDEN';
        message = message.replace('FORBIDDEN:', '').trim();
      } else if (message.startsWith('VALIDATION:')) {
        statusCode = 422;
        code = 'VALIDATION_ERROR';
        message = message.replace('VALIDATION:', '').trim();
      } else if (message.startsWith('BAD_REQUEST:')) {
        statusCode = 400;
        code = 'BAD_REQUEST';
        message = message.replace('BAD_REQUEST:', '').trim();
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code,
          message,
          ...(metadata ? { metadata } : {}),
          ...(error instanceof Error ? { stack: error.stack, originalMessage: error.message } : {}),
        },
      },
      { status: statusCode }
    );
  }
}
