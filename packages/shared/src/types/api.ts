export interface PaginationInput {
  readonly page?: number;
  readonly limit?: number;
}

export interface NormalizedPagination {
  readonly page: number;
  readonly limit: number;
}

export interface PaginationMetadata extends NormalizedPagination {
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

export interface ApiSuccessResponse<TData, TMetadata = never> {
  readonly success: true;
  readonly data: TData;
  readonly metadata?: TMetadata;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: ApiError;
  readonly correlationId?: string;
}
