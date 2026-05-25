/**
 * User lookups. JIRA assignment APIs only accept `accountId`, but every other
 * system you'd integrate with talks in emails — so a "find by email" helper is
 * the bridge.
 *
 * Note: on JIRA Cloud, querying by email requires the calling user to have the
 * "User Browsing" global permission AND the target user's email visibility to
 * not be hidden. Hidden-email accounts can only be found by displayName.
 */
import type { JiraClient } from "./client";
import type { JiraUser } from "./types";

/**
 * Search for users. Matches against displayName and (where visible) email.
 * Returns up to `maxResults` (default 10) results in JIRA's relevance order.
 */
export async function searchUsers(
  client: JiraClient,
  query: string,
  options: { maxResults?: number } = {},
): Promise<JiraUser[]> {
  const raw = await client.request<RawJiraUser[]>(client.apiPath("/user/search"), {
    query: { query, maxResults: options.maxResults ?? 10 },
  });
  return raw.map(toJiraUser);
}

/**
 * Convenience wrapper: find a single active user whose email matches. Returns
 * null if no match (rather than throwing) — assignment is often best-effort.
 *
 * The match is case-insensitive on the local part since JIRA normalizes the
 * stored email but query matching is case-sensitive on some clusters.
 */
export async function findUserByEmail(
  client: JiraClient,
  email: string,
): Promise<JiraUser | null> {
  const results = await searchUsers(client, email, { maxResults: 5 });
  const target = email.toLowerCase();
  return (
    results.find((u) => u.active && u.emailAddress?.toLowerCase() === target) ??
    results.find((u) => u.emailAddress?.toLowerCase() === target) ??
    null
  );
}

/** Fetch a single user by accountId. Useful for validating an assignment id. */
export async function getUser(client: JiraClient, accountId: string): Promise<JiraUser> {
  const raw = await client.request<RawJiraUser>(client.apiPath("/user"), {
    query: { accountId },
  });
  return toJiraUser(raw);
}

/** Get the authenticated user — handy for default-assignee logic. */
export async function getCurrentUser(client: JiraClient): Promise<JiraUser> {
  const raw = await client.request<RawJiraUser>(client.apiPath("/myself"));
  return toJiraUser(raw);
}

// ---------- Shaping ----------

interface RawJiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active?: boolean;
}

function toJiraUser(u: RawJiraUser): JiraUser {
  return {
    accountId: u.accountId,
    displayName: u.displayName,
    emailAddress: u.emailAddress,
    active: u.active ?? true,
  };
}
