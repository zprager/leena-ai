/**
 * Minimal JIRA REST API client. Owns auth, base URL, and the raw HTTP wire —
 * higher-level resource modules (tickets, comments, transitions) call
 * `client.request()` and shape the response.
 *
 * Designed to be project-agnostic: pass any `JiraClientConfig` and it works
 * outside this codebase too. The triage-specific glue lives in `poller.ts`.
 */
import type { JiraAuth, JiraClientConfig } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export interface JiraRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON-serializable body. */
  body?: unknown;
  /** Query-string params (string-encoded). Skipped if undefined. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Extra headers merged on top of the defaults. */
  headers?: Record<string, string>;
  /** Per-call timeout override. */
  timeoutMs?: number;
}

export class JiraClient {
  readonly baseUrl: string;
  readonly auth: JiraAuth;
  readonly apiVersion: "2" | "3";
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: JiraClientConfig) {
    if (!config.baseUrl) throw new Error("JiraClient: baseUrl is required");
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.auth = config.auth;
    this.apiVersion = config.apiVersion ?? "3";
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? fetch;
  }

  /** Authorization header derived from the configured auth strategy. */
  private authHeader(): string {
    if (this.auth.kind === "basic") {
      const token = Buffer.from(`${this.auth.email}:${this.auth.apiToken}`).toString("base64");
      return `Basic ${token}`;
    }
    return `Bearer ${this.auth.accessToken}`;
  }

  /** Build a fully-qualified URL with optional query string. */
  private buildUrl(path: string, query?: JiraRequestOptions["query"]): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalized}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Convenience: prefixes the standard `/rest/api/{version}` path. Use this
   * for the issue/comment/transition endpoints. Service Desk has its own root
   * (`/rest/servicedeskapi`) — use `request()` directly for those.
   */
  apiPath(suffix: string): string {
    const trimmed = suffix.startsWith("/") ? suffix : `/${suffix}`;
    return `/rest/api/${this.apiVersion}${trimmed}`;
  }

  /**
   * The single HTTP entry point. Resource modules build the path and parse the
   * typed response on top of this. Non-2xx responses throw `JiraApiError`
   * carrying the parsed body so callers can log/diagnose without re-parsing.
   */
  async request<T = unknown>(path: string, options: JiraRequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const method = options.method ?? "GET";

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: this.authHeader(),
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // 204 No Content (transitions, deletes) — nothing to parse.
    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload: unknown = isJson ? await res.json().catch(() => undefined) : await res.text();

    if (!res.ok) {
      const message = extractErrorMessage(payload) ?? `${res.status} ${res.statusText}`;
      throw new JiraApiError(`JIRA ${method} ${path}: ${message}`, res.status, path, payload);
    }

    return payload as T;
  }
}

/** Pull the most useful message out of a JIRA error payload, if shaped as expected. */
function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.errorMessages) && p.errorMessages.length > 0) {
    return (p.errorMessages as unknown[]).join("; ");
  }
  if (p.errors && typeof p.errors === "object") {
    const parts = Object.entries(p.errors as Record<string, unknown>).map(
      ([k, v]) => `${k}: ${String(v)}`,
    );
    if (parts.length) return parts.join("; ");
  }
  if (typeof p.message === "string") return p.message;
  return undefined;
}
