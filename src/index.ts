import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { fail, ok, paginated } from "./utils/response";
import { createPageValidator, updatePageValidator } from "./validators/records";

export type Bindings = {
  DB: D1Database;
  USERNAME: string;
  PASSWORD: string;
};

export type Record = {
  id: number;
  url: string;
  title: string | null;
  timestamp: number;
  created_at: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  prettyJSON(),
  logger(),
  basicAuth({
    verifyUser: (username, password, c) =>
      username === c.env.USERNAME && password === c.env.PASSWORD,
  }),
);

const parsePositiveIneger = (value: string | undefined): number | null => {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return Number(value);
};

const parseNonNegativeInteger = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }

  return Number(value);
};

app.get("/records", async (c) => {
  const limitValue = c.req.query("limit");
  const offsetValue = c.req.query("offset");

  const limit = limitValue === undefined ? 100 : parsePositiveIneger(limitValue);
  const offset = offsetValue === undefined ? 0 : parseNonNegativeInteger(offsetValue);

  if (limit === null) {
    return fail(c, "limit must be a positive integer", 400);
  }

  if (offset === null) {
    return fail(c, "offset must be a non-negative integer", 400);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT id, url, title, timestamp, created_at FROM records ORDER BY id DESC LIMIT ? OFFSET ?",
  )
    .bind(limit, offset)
    .all<Record>();

  return paginated(c, results, { limit, offset });
});

app.post("/record", createPageValidator, async (c) => {
  const { url, title, timestamp } = c.req.valid("json");

  const record = await c.env.DB.prepare(
    "INSERT INTO records (url, title, timestamp) VALUES (?, ?, ?) RETURNING id, url, title, timestamp, created_at",
  )
    .bind(url, title, timestamp)
    .first<Record>();
  if (!record) {
    return fail(c, "failed to create record", 500);
  }
  return ok(c, { record }, 201);
});

app.patch("/record/:id", updatePageValidator, async (c) => {
  const id = parsePositiveIneger(c.req.param("id"));
  if (id === null) {
    return fail(c, "id must be a positive integer", 400);
  }

  const { url, title, timestamp } = c.req.valid("json");

  const setClauses: string[] = [];
  const values: Array<string | number | null> = [];

  if (url !== undefined) {
    setClauses.push("url = ?");
    values.push(url);
  }
  if (title !== undefined) {
    setClauses.push("title = ?");
    values.push(title);
  }
  if (timestamp !== undefined) {
    setClauses.push("timestamp = ?");
    values.push(timestamp);
  }

  const record = await c.env.DB.prepare(
    `UPDATE records set ${setClauses.join(", ")} WHERE id = ? RETURNING id, url, title, timestamp, created_at`,
  )
    .bind(...values, id)
    .first<Record>();
  if (!record) {
    return fail(c, "record not found", 404);
  }
  return ok(c, { record });
});

app.delete("/record/:id", async (c) => {
  const id = parsePositiveIneger(c.req.param("id"));
  if (id === null) {
    return fail(c, "id must be a positive integer", 400);
  }

  const record = await c.env.DB.prepare(
    "DELETE FROM records WHERE id = ? RETURNING id, url, title, timestamp, created_at",
  )
    .bind(id)
    .first<Record>();
  if (!record) {
    return fail(c, "record not found", 404);
  }
  return ok(c, { record });
});

export default app;
