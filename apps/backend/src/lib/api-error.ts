export class ApiError extends Error {
  public statusCode: number;
  public code?: string;
  public metadata?: Record<string, any>;

  constructor(message: string, statusCode: number = 500, code?: string, metadata?: Record<string, any>) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code || this.getDefaultCode(statusCode);
    this.metadata = metadata;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  private getDefaultCode(statusCode: number): string {
    switch (statusCode) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 422: return 'VALIDATION_ERROR';
      case 429: return 'TOO_MANY_REQUESTS';
      case 500: return 'INTERNAL_SERVER_ERROR';
      default: return 'ERROR';
    }
  }

  static badRequest(message: string, metadata?: Record<string, any>) {
    return new ApiError(message, 400, 'BAD_REQUEST', metadata);
  }

  static unauthorized(message: string = 'Unauthorized', metadata?: Record<string, any>) {
    return new ApiError(message, 401, 'UNAUTHORIZED', metadata);
  }

  static forbidden(message: string = 'Forbidden', metadata?: Record<string, any>) {
    return new ApiError(message, 403, 'FORBIDDEN', metadata);
  }

  static notFound(message: string = 'Not Found', metadata?: Record<string, any>) {
    return new ApiError(message, 404, 'NOT_FOUND', metadata);
  }

  static conflict(message: string, metadata?: Record<string, any>) {
    return new ApiError(message, 409, 'CONFLICT', metadata);
  }

  static validationError(message: string, metadata?: Record<string, any>) {
    return new ApiError(message, 422, 'VALIDATION_ERROR', metadata);
  }

  static internal(message: string = 'Internal Server Error', metadata?: Record<string, any>) {
    return new ApiError(message, 500, 'INTERNAL_SERVER_ERROR', metadata);
  }
}
