import { validator } from "hono/validator";

import { fail } from "../utils/response";

export type CreatePageInput = {
  url: string;
  title: string | null;
  timestamp: number;
};

export type UpdatePageInput = {
  url?: string;
  title?: string | null;
  timestamp?: number;
};

const isJsonObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const createPageValidator = validator("json", (value, c) => {
  if (!isJsonObject(value)) {
    return fail(c, "request body must be a JSON object", 400);
  }

  const { url, title, timestamp } = value;
  if (typeof url !== "string" || url.trim() === "") {
    return fail(c, "url is required and must be a non-empty string", 400);
  }
  if (typeof timestamp !== "number" || !Number.isInteger(timestamp)) {
    return fail(c, "timestamp is required and must be an integer", 400);
  }
  if (title !== undefined && title !== null && typeof title !== "string") {
    return fail(c, "title must be a string or null", 400);
  }

  return {
    url,
    title: title ?? null,
    timestamp,
  } satisfies CreatePageInput;
});

export const updatePageValidator = validator("json", (value, c) => {
  if (!isJsonObject(value)) {
    return c.json({ error: "request body must be a JSON object" }, 400);
  }

  const input: UpdatePageInput = {};

  if ("url" in value) {
    const url = value.url;
    if (typeof url !== "string" || url.trim() === "") {
      return fail(c, "url must be a non-empty string", 400);
    }
    input.url = url;
  }
  if ("title" in value) {
    const title = value.title;
    if (title !== null && typeof title !== "string") {
      return fail(c, "title must be a string or null", 400);
    }
    input.title = title;
  }
  if ("timestamp" in value) {
    const timestamp = value.timestamp;
    if (typeof timestamp !== "number" || !Number.isInteger(timestamp)) {
      return fail(c, "timestamp must be an integer", 400);
    }
    input.timestamp = timestamp;
  }

  if (input.url === undefined && input.title === undefined && input.timestamp === undefined) {
    return fail(c, "at least one of url, title, or timestamp must be provided", 400);
  }

  return input;
});
