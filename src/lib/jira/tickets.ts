/**
 * Ticket-level operations against the JIRA Issue REST API.
 *
 * The agent only reads three things per ticket — key, summary, plain-text
 * description — so we shape the API's wide payload down to {@link JiraTicket}
 * and stash the original under `raw` for callers that need more.
 */
import { JiraClient } from "./client";
import { markdownToAdf } from "./comments";
import type {
  CreateTicketInput,
  JiraTicket,
  JiraTicketPage,
  ListTicketsOptions,
} from "./types";

/** Default fields we ask the search API for. Pulled into the shaped JiraTicket. */
const DEFAULT_FIELDS = ["summary", "description", "status", "labels", "reporter", "created", "updated"];

/**
 * List tickets matching a JQL query. Uses the cursor-paginated
 * `/rest/api/3/search/jql` endpoint (the older `startAt`/`total` search is
 * deprecated on Cloud).
 *
 * @example
 *   const page = await listTickets(client, {
 *     jql: 'project = HELPDESK AND status = "Waiting for triage"',
 *     pageSize: 25,
 *   });
 */
export async function listTickets(
  client: JiraClient,
  options: ListTicketsOptions,
): Promise<JiraTicketPage> {
  const fields = options.fields ? [...new Set([...DEFAULT_FIELDS, ...options.fields])] : DEFAULT_FIELDS;

  const body = {
    jql: options.jql,
    nextPageToken: options.pageToken,
    maxResults: options.pageSize ?? 50,
    fields,
  };

  const res = await client.request<{
    issues?: RawJiraIssue[];
    nextPageToken?: string;
    isLast?: boolean;
  }>(client.apiPath("/search/jql"), { method: "POST", body });

  const issues = res.issues ?? [];
  return {
    tickets: issues.map(toJiraTicket),
    nextPageToken: res.nextPageToken,
    // The new endpoint signals end-of-stream by either omitting nextPageToken
    // or returning `isLast: true`. Treat both as "no more pages".
    isLast: res.isLast ?? !res.nextPageToken,
  };
}

/**
 * Async generator that pages through every ticket matching the JQL. Use this
 * when you want to process the whole backlog without managing tokens by hand.
 */
export async function* iterTickets(
  client: JiraClient,
  options: ListTicketsOptions,
): AsyncGenerator<JiraTicket> {
  let pageToken = options.pageToken;
  for (;;) {
    const page = await listTickets(client, { ...options, pageToken });
    for (const t of page.tickets) yield t;
    if (page.isLast || !page.nextPageToken) return;
    pageToken = page.nextPageToken;
  }
}

/** Fetch one ticket by key (e.g. "HELPDESK-123"). */
export async function getTicket(client: JiraClient, key: string): Promise<JiraTicket> {
  const issue = await client.request<RawJiraIssue>(
    client.apiPath(`/issue/${encodeURIComponent(key)}`),
    { query: { fields: DEFAULT_FIELDS.join(",") } },
  );
  return toJiraTicket(issue);
}

/**
 * Create a new ticket. Returns the newly-created issue (re-fetched so the
 * caller gets the full shaped {@link JiraTicket} rather than the bare
 * `{id, key, self}` POST response).
 *
 * Common pitfalls:
 *   - `issueType` must exist in the project; "Task" is the safest default.
 *   - `priority` is schema-dependent; some projects have it disabled.
 *   - `assigneeAccountId` requires the user to be assignable to the project.
 *
 * @example
 *   const created = await createTicket(client, {
 *     projectKey: "HELPDESK",
 *     summary: "MFA token won't enroll",
 *     description: "Tried Okta Verify three times…",
 *     labels: ["from-agent"],
 *   });
 */
export async function createTicket(
  client: JiraClient,
  input: CreateTicketInput,
): Promise<JiraTicket> {
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    summary: input.summary,
    issuetype: { name: input.issueType ?? "Task" },
  };

  if (input.description) {
    fields.description = client.apiVersion === "3" ? markdownToAdf(input.description) : input.description;
  }
  if (input.labels && input.labels.length > 0) fields.labels = input.labels;
  if (input.assigneeAccountId) fields.assignee = { accountId: input.assigneeAccountId };
  if (input.reporterAccountId) fields.reporter = { accountId: input.reporterAccountId };
  if (input.priority) fields.priority = { name: input.priority };

  const merged = { ...fields, ...(input.extraFields ?? {}) };

  const res = await client.request<{ id: string; key: string }>(client.apiPath("/issue"), {
    method: "POST",
    body: { fields: merged },
  });

  // Re-fetch to return the same shape as listTickets/getTicket. The POST
  // response is intentionally minimal (id + key + self), which is awkward for
  // callers that want to immediately inspect the new ticket.
  return getTicket(client, res.key);
}

/**
 * Assign a ticket to a user. Pass `null` to unassign, or the special string
 * `"-1"` to set automatic assignment (JIRA's default-assignee rule).
 *
 * Most callers want to assign by email — use {@link findUserByEmail} to look
 * up the accountId first, since the assignment API only accepts accountIds.
 */
export async function assignTicket(
  client: JiraClient,
  issueKey: string,
  accountId: string | null,
): Promise<void> {
  await client.request<void>(
    client.apiPath(`/issue/${encodeURIComponent(issueKey)}/assignee`),
    { method: "PUT", body: { accountId } },
  );
}

/**
 * Hard-delete a JIRA issue. There is no soft-delete in Jira Cloud — once
 * gone, it's gone. Use `deleteSubtasks: true` if the issue might own
 * subtasks (DELETE 404s on parents with subtasks otherwise).
 *
 * Requires the "Delete Issues" project permission. Site admins have it by
 * default; regular users may not.
 */
export async function deleteTicket(
  client: JiraClient,
  issueKey: string,
  opts: { deleteSubtasks?: boolean } = {},
): Promise<void> {
  const query = opts.deleteSubtasks ? "?deleteSubtasks=true" : "";
  await client.request<void>(
    client.apiPath(`/issue/${encodeURIComponent(issueKey)}${query}`),
    { method: "DELETE" },
  );
}

// ---------- Shaping helpers ----------

interface RawJiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown; // ADF in v3, string in v2
    status?: { id: string; name: string };
    labels?: string[];
    reporter?: {
      accountId: string;
      displayName: string;
      emailAddress?: string;
    } | null;
    created?: string;
    updated?: string;
  };
}

function toJiraTicket(issue: RawJiraIssue): JiraTicket {
  const f = issue.fields ?? {};
  return {
    id: issue.id,
    key: issue.key,
    summary: f.summary ?? "",
    description: adfToPlainText(f.description),
    status: {
      id: f.status?.id ?? "",
      name: f.status?.name ?? "",
    },
    labels: f.labels ?? [],
    reporter: f.reporter
      ? {
          accountId: f.reporter.accountId,
          displayName: f.reporter.displayName,
          emailAddress: f.reporter.emailAddress,
        }
      : undefined,
    created: f.created ?? "",
    updated: f.updated ?? "",
    raw: issue,
  };
}

/**
 * Flatten an Atlassian Document Format (ADF) tree into plain text — enough for
 * the triage prompt, which doesn't care about formatting. Falls back to the
 * input itself if it's already a string (v2 API or migrated tickets).
 *
 * We walk the node tree, joining text nodes with appropriate whitespace:
 * paragraphs/headings get double newlines, list items get bullets, hardBreaks
 * become newlines. Unknown node types are traversed transparently.
 */
export function adfToPlainText(doc: unknown): string {
  if (doc == null) return "";
  if (typeof doc === "string") return doc;
  if (typeof doc !== "object") return "";

  const out: string[] = [];
  walk(doc as AdfNode, out);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
}

function walk(node: AdfNode, out: string[]): void {
  if (!node || typeof node !== "object") return;

  // Text nodes carry the actual content. Marks (bold/code/etc) are ignored —
  // we're producing plain text for the LLM, not rendering.
  if (node.type === "text" && typeof node.text === "string") {
    out.push(node.text);
    return;
  }

  // Block-level types that should be separated from siblings.
  const blockTypes = new Set(["paragraph", "heading", "blockquote", "codeBlock"]);
  const listItemTypes = new Set(["listItem"]);

  if (node.type === "hardBreak") {
    out.push("\n");
    return;
  }

  if (listItemTypes.has(node.type ?? "")) {
    out.push("• ");
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, out);
  }

  if (blockTypes.has(node.type ?? "") || listItemTypes.has(node.type ?? "")) {
    out.push("\n\n");
  }
}
