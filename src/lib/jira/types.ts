/**
 * JIRA REST API types — scoped to the surface this connector actually uses.
 * The real JIRA API has hundreds of fields per resource; we deliberately only
 * model the ones the triage pipeline reads or writes, so the contract is small
 * and obvious. Everything else lives in `fields` as `unknown`.
 *
 * Targets the Cloud REST API v3 (https://developer.atlassian.com/cloud/jira/platform/rest/v3/).
 */

// ---------- Auth ----------

/**
 * Basic auth — JIRA Cloud's recommended path for scripts and integrations.
 * `email` is the Atlassian account email, `apiToken` is generated at
 * https://id.atlassian.com/manage-profile/security/api-tokens.
 */
export interface JiraBasicAuth {
  kind: "basic";
  email: string;
  apiToken: string;
}

/**
 * OAuth 2.0 bearer token — for 3LO flows or pre-minted access tokens. Token
 * refresh is out of scope for this client; callers supply a fresh token.
 */
export interface JiraOAuth {
  kind: "oauth";
  accessToken: string;
}

export type JiraAuth = JiraBasicAuth | JiraOAuth;

// ---------- Client config ----------

export interface JiraClientConfig {
  /** e.g. https://yourco.atlassian.net */
  baseUrl: string;
  auth: JiraAuth;
  /** REST API version. v3 is Cloud-only; v2 works for Server/DC and Cloud. */
  apiVersion?: "2" | "3";
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Optional fetch override — useful for testing. Defaults to global fetch. */
  fetch?: typeof fetch;
}

// ---------- Tickets ----------

/**
 * The trimmed JIRA issue shape the agent cares about. Full payload is preserved
 * in `raw` for callers that need fields we didn't model.
 */
export interface JiraTicket {
  /** e.g. "HELPDESK-123" */
  key: string;
  /** Internal numeric id (stringified). */
  id: string;
  summary: string;
  /** Plain-text rendering of the description (ADF flattened). May be empty. */
  description: string;
  status: {
    id: string;
    name: string;
  };
  labels: string[];
  reporter?: {
    accountId: string;
    displayName: string;
    emailAddress?: string;
  };
  created: string;
  updated: string;
  /** Untouched API payload — for fields we didn't pull up. */
  raw: unknown;
}

/**
 * Pagination envelope returned by the search endpoint. `nextPageToken` is the
 * cloud v3 cursor-based pagination signal (replaced the older `startAt`/`total`
 * pattern).
 */
export interface JiraTicketPage {
  tickets: JiraTicket[];
  nextPageToken?: string;
  isLast: boolean;
}

export interface ListTicketsOptions {
  jql: string;
  pageSize?: number;
  /** Cursor from a prior page's `nextPageToken`. */
  pageToken?: string;
  /** Extra fields to pull beyond the default set. */
  fields?: string[];
}

// ---------- Users ----------

/**
 * Trimmed JIRA user record. `accountId` is the stable identifier — emails and
 * display names can change, accountIds don't.
 */
export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active: boolean;
}

// ---------- Ticket creation ----------

/**
 * Input for {@link createTicket}. `projectKey` and `summary` are the only
 * required fields; everything else is optional and maps directly onto JIRA's
 * `fields` payload.
 */
export interface CreateTicketInput {
  projectKey: string;
  summary: string;
  description?: string;
  /** Issue type name (e.g. "Task", "Bug"). Defaults to "Task" if omitted. */
  issueType?: string;
  labels?: string[];
  /** Assignee accountId. Use {@link findUserByEmail} to resolve from email. */
  assigneeAccountId?: string;
  /** Reporter accountId. Defaults to the authenticated user when omitted. */
  reporterAccountId?: string;
  /** Priority name (e.g. "High", "Medium"). Schema-dependent. */
  priority?: string;
  /** Extra raw field overrides — merged into `fields` last, so they win. */
  extraFields?: Record<string, unknown>;
}

// ---------- Comments ----------

export interface JiraComment {
  id: string;
  body: string;
  created: string;
  author?: {
    accountId: string;
    displayName: string;
  };
}

// ---------- Transitions ----------

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    id: string;
    name: string;
  };
}

// ---------- Queue config ----------

/**
 * What the poller needs to know about a queue: which tickets to pick up, and
 * which transitions to apply for each agent decision.
 */
export interface JiraQueueConfig {
  /** JQL used to fetch new/unprocessed tickets. */
  jql: string;
  /** Transition id to fire on a RESOLVE decision. */
  resolveTransitionId?: string;
  /** Transition id to fire on a DEFER decision. */
  deferTransitionId?: string;
}
