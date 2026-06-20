import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/index";
import type { Bindings, Record } from "../src/index";
import { ErrorResponse, SuccessResponse } from "../src/utils/response";

type TestEnv = Env & Bindings;

const TEST_USERNAME = "admin";
const TEST_PASSWORD = "123456";

const getBindings = (): TestEnv => {
  const db = (env as unknown as { DB: D1Database }).DB;

  return {
    ...(env as unknown as object),
    DB: db,
    USERNAME: TEST_USERNAME,
    PASSWORD: TEST_PASSWORD,
  } as TestEnv;
};

const setupDatabase = async () => {
  const { DB } = getBindings();
  await DB.prepare("DROP TABLE IF EXISTS records").run();

  await DB.prepare(
    `
			CREATE TABLE records (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				url TEXT NOT NULL,
				title TEXT,
				timestamp INTEGER NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`,
  ).run();

  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_url ON records(url)").run();
};

const seedRecord = async (
  input: {
    url?: string;
    title?: string | null;
    timestamp?: number;
  } = {},
): Promise<Record> => {
  const { DB } = getBindings();

  const page = await DB.prepare(
    "INSERT INTO records (url, title, timestamp) VALUES (?, ?, ?) RETURNING id, url, title, timestamp, created_at",
  )
    .bind(
      input.url ?? "https://example.com",
      input.title === undefined ? "Example" : input.title,
      input.timestamp ?? 1781271701,
    )
    .first<Record>();

  if (!page) {
    throw new Error("Failed to seed page");
  }

  return page;
};

const request = async (
  path: string,
  init: RequestInit = {},
  options: {
    auth?: boolean;
  } = {
    auth: true,
  },
) => {
  const bindings = getBindings();
  const ctx = createExecutionContext();

  const headers = new Headers(init.headers);

  if (options.auth !== false) {
    headers.set("Authorization", `Basic ${btoa(`${TEST_USERNAME}:${TEST_PASSWORD}`)}`);
  }

  const response = await worker.fetch(
    new Request(`https://example.com${path}`, {
      ...init,
      headers,
    }),
    bindings,
    ctx,
  );

  await waitOnExecutionContext(ctx);

  return response;
};

const jsonRequest = async (
  path: string,
  init: Omit<RequestInit, "body"> & {
    body?: unknown;
  } = {},
  options?: {
    auth?: boolean;
  },
) => {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return request(
    path,
    {
      ...init,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    options,
  );
};

describe("API", () => {
  beforeEach(async () => {
    await setupDatabase();
  });

  it("rejects requests without basic auth credentials", async () => {
    const res = await request("/records", {}, { auth: false });

    expect(res.status).toBe(401);
  });

  it("GET /records returns pagenated records", async () => {
    await seedRecord({
      url: "https://example.com/one",
      title: "One",
      timestamp: 100,
    });
    await seedRecord({
      url: "https://example.com/two",
      title: "Two",
      timestamp: 200,
    });

    const res = await request("/records?limit=1&offset=0");
    expect(res.status).toBe(200);

    const body = (await res.json()) as SuccessResponse<{
      items: Record[];
      pagination: {
        limit: number;
        offset: number;
        total?: number;
        count: number;
      };
    }>;
    expect(body.success).toBe(true);
    expect(body.data.pagination.limit).toBe(1);
    expect(body.data.pagination.offset).toBe(0);
    expect(body.data.pagination.total).toBeUndefined();
    expect(body.data.pagination.count).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      url: "https://example.com/two",
      title: "Two",
      timestamp: 200,
    });
  });

  it("GET /records validates limit", async () => {
    const res = await request("/records?limit=0");
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("limit must be a positive integer");
  });

  it("GET /records validates offset", async () => {
    const res = await request("/records?offset=-1");
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("offset must be a non-negative integer");
  });

  it("POST /record creates a record", async () => {
    const res = await jsonRequest("/record", {
      method: "POST",
      body: {
        url: "https://example.com/one",
        title: "One",
        timestamp: 100,
      },
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as SuccessResponse<{
      record: Record;
    }>;

    expect(body.success).toBe(true);
    expect(body.data.record).toMatchObject({
      url: "https://example.com/one",
      title: "One",
      timestamp: 100,
    });
    expect(body.data.record.id).toEqual(expect.any(Number));
    expect(body.data.record.created_at).toEqual(expect.any(String));
  });

  it("POST /record allows title to be omitted", async () => {
    const res = await jsonRequest("/record", {
      method: "POST",
      body: {
        url: "https://example.com/no-title",
        timestamp: 100,
      },
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as SuccessResponse<{
      record: Record;
    }>;
    expect(body.data.record).toMatchObject({
      url: "https://example.com/no-title",
      title: null,
      timestamp: 100,
    });
  });

  it("POST /record rejects invalid body", async () => {
    const res = await jsonRequest("/record", {
      method: "POST",
      body: {
        url: "",
        title: "Invalid",
        timestamp: 500,
      },
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("url is required and must be a non-empty string");
  });

  it("PATCH /record/:id updates a record", async () => {
    const record = await seedRecord({
      url: "https://example.com/old",
      title: "Old title",
      timestamp: 100,
    });

    const res = await jsonRequest(`/record/${record.id}`, {
      method: "PATCH",
      body: {
        title: "New title",
        timestamp: 200,
      },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as SuccessResponse<{ record: Record }>;
    expect(body.success).toBe(true);
    expect(body.data.record).toMatchObject({
      id: record.id,
      url: "https://example.com/old",
      title: "New title",
      timestamp: 200,
    });
  });

  it("PATCH /record/:id can set title to null", async () => {
    const record = await seedRecord({
      title: "Will be cleared",
    });

    const res = await jsonRequest(`/record/${record.id}`, {
      method: "PATCH",
      body: {
        title: null,
      },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as SuccessResponse<{ record: Record }>;
    expect(body.success).toBe(true);
    expect(body.data.record.title).toBeNull();
  });

  it("PATCH /record/:id rejects empty update body", async () => {
    const record = await seedRecord();

    const res = await jsonRequest(`/record/${record.id}`, {
      method: "PATCH",
      body: {},
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("at least one of url, title, or timestamp must be provided");
  });

  it("PATCH /record/:id returns 404 for missing record", async () => {
    const res = await jsonRequest("/record/99999", {
      method: "PATCH",
      body: {
        title: "Missing",
      },
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("record not found");
  });

  it("DELETE /record/:id deletes a record", async () => {
    const record = await seedRecord();

    const res = await request(`/record/${record.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as SuccessResponse<{ record: Record }>;
    expect(body.success).toBe(true);
    expect(body.data.record.id).toBe(record.id);

    const deleted = await getBindings()
      .DB.prepare("SELECT id FROM records WHERE id = ?")
      .bind(record.id)
      .first();
    expect(deleted).toBeNull();
  });

  it("DELETE /record/:id returns 404 for missing record", async () => {
    const res = await request("/record/99999", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorResponse;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("record not found");
  });
});
