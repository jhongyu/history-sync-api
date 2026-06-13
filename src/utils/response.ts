import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type SuccessResponse<T> = {
  success: true;
  data: T;
};

export type ErrorResponse = {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
};

export const ok = <T>(c: Context, data: T, status: ContentfulStatusCode = 200) => {
  return c.json<SuccessResponse<T>>(
    {
      success: true,
      data,
    },
    status,
  );
};

export const paginated = <T>(
  c: Context,
  items: T[],
  pagination: { limit: number; offset: number; total?: number },
) => {
  return ok(c, {
    items,
    pagination: {
      ...pagination,
      count: items.length,
    },
  });
};

export const fail = (
  c: Context,
  message: string,
  status: ContentfulStatusCode = 400,
  options?: {
    code?: string;
    details?: unknown;
  },
) => {
  return c.json<ErrorResponse>(
    {
      success: false,
      error: {
        message,
        ...(options?.code ? { code: options.code } : {}),
        ...(options?.details !== undefined ? { details: options.details } : {}),
      },
    },
    status,
  );
};
