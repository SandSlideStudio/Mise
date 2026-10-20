/**
 * One error shape for the whole API, so the client never has to guess how a
 * failure is expressed.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static notFound(what: string): ApiError {
    return new ApiError(404, 'not_found', `${what} was not found.`);
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'bad_request', message, details);
  }

  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }
}
