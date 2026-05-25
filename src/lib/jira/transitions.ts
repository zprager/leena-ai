/**
 * Workflow transitions — moving a ticket from one status to another.
 *
 * JIRA workflows are project-specific, so the transition ids you need can't be
 * known up front; call `listTransitions(client, key)` once for any ticket in
 * the target project to discover the ids ("Resolve" → "31", etc.), then store
 * those in env vars for the poller to use.
 */
import { JiraClient } from "./client";
import type { JiraTransition } from "./types";

/**
 * List the transitions currently available for an issue. The result depends on
 * the issue's current status and the workflow's permission rules.
 */
export async function listTransitions(
  client: JiraClient,
  issueKey: string,
): Promise<JiraTransition[]> {
  const res = await client.request<{ transitions?: JiraTransition[] }>(
    client.apiPath(`/issue/${encodeURIComponent(issueKey)}/transitions`),
  );
  return res.transitions ?? [];
}

/** Fire a transition by id. Returns once JIRA acknowledges (204 No Content). */
export async function transitionTicket(
  client: JiraClient,
  issueKey: string,
  transitionId: string,
  options: { comment?: string } = {},
): Promise<void> {
  const body: Record<string, unknown> = {
    transition: { id: transitionId },
  };

  // The transition endpoint accepts an inline comment using the same ADF shape
  // as the comments API. We pass it through as a plain string for v2 and lazy-
  // load the converter for v3 to avoid an unused import on the v2 path.
  if (options.comment) {
    if (client.apiVersion === "3") {
      const { markdownToAdf } = await import("./comments");
      body.update = {
        comment: [{ add: { body: markdownToAdf(options.comment) } }],
      };
    } else {
      body.update = {
        comment: [{ add: { body: options.comment } }],
      };
    }
  }

  await client.request<void>(client.apiPath(`/issue/${encodeURIComponent(issueKey)}/transitions`), {
    method: "POST",
    body,
  });
}

/**
 * Resolve a transition id by status name (case-insensitive). Use this when you
 * don't have ids configured in env and just want "move this to Resolved".
 * Returns null if no transition matches.
 */
export async function findTransitionByName(
  client: JiraClient,
  issueKey: string,
  targetName: string,
): Promise<JiraTransition | null> {
  const transitions = await listTransitions(client, issueKey);
  const lower = targetName.toLowerCase();
  return (
    transitions.find((t) => t.name.toLowerCase() === lower) ??
    transitions.find((t) => t.to.name.toLowerCase() === lower) ??
    null
  );
}
