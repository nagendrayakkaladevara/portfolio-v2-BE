import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  let status = 500,
    code = "internal_error",
    detail = "Something went wrong. Try again later.";
  if (error instanceof HttpError) {
    status = error.status;
    code = error.code;
    detail = error.message;
  } else if (error instanceof ZodError) {
    status = 400;
    code = "validation_failed";
    detail = "Request does not match the API schema.";
  } else if (error?.type === "entity.too.large") {
    status = 413;
    code = "payload_too_large";
    detail = "Request body is too large.";
  } else if (error?.type === "entity.parse.failed") {
    status = 400;
    code = "invalid_json";
    detail = "Malformed JSON.";
  } else if (error?.code === "23505") {
    status = 409;
    code = "conflict";
    detail = "This resource already exists.";
  }
  res
    .status(status)
    .type("application/problem+json")
    .json({
      type: `urn:portfolio:error:${code}`,
      title: code,
      status,
      detail,
      requestId: res.locals.requestId,
    });
};
