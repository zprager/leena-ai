/**
 * JIRA Service Desk connector — barrel export.
 *
 * Two levels of API:
 *   - Low-level: {@link JiraClient} + resource helpers (`listTickets`,
 *     `postComment`, `transitionTicket`, …). Use these for ad-hoc scripts or
 *     to build a different workflow on top of JIRA.
 *   - High-level: {@link JiraPoller} + {@link triageHandler} to wire the
 *     triage pipeline at a queue and let it run.
 *
 * The {@link buildClientFromEnv} convenience reads the JIRA_* env vars
 * validated in `src/lib/env.ts`. Returns null if JIRA isn't configured —
 * callers can branch on that to keep the rest of the agent usable offline.
 */
export { JiraClient, JiraApiError } from "./client";
export type { JiraRequestOptions } from "./client";

export {
  listTickets,
  iterTickets,
  getTicket,
  createTicket,
  assignTicket,
  deleteTicket,
  adfToPlainText,
} from "./tickets";
export {
  createProject,
  listTemplates,
  validateProjectKey,
} from "./projects";
export type { CreateProjectInput, JiraProjectCreateResult, TemplateAlias } from "./projects";
export { postComment, addLabels, markdownToAdf } from "./comments";
export { listTransitions, transitionTicket, findTransitionByName } from "./transitions";
export { searchUsers, findUserByEmail, getUser, getCurrentUser } from "./users";

export { JiraPoller, triageHandler } from "./poller";
export type {
  PollerOptions,
  PollerContext,
  PollerEvent,
  TicketHandler,
  TriageHandlerOptions,
} from "./poller";

export type {
  JiraAuth,
  JiraBasicAuth,
  JiraOAuth,
  JiraClientConfig,
  JiraTicket,
  JiraTicketPage,
  ListTicketsOptions,
  CreateTicketInput,
  JiraComment,
  JiraTransition,
  JiraQueueConfig,
  JiraUser,
} from "./types";

import { env } from "@/lib/env";
import { JiraClient } from "./client";
import type { JiraQueueConfig } from "./types";

/**
 * Build a {@link JiraClient} from the validated env. Returns null if the
 * required JIRA env vars (base URL + email + token) are not set, so the rest
 * of the agent can stay usable without a JIRA connection.
 */
export function buildClientFromEnv(): JiraClient | null {
  if (!env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) return null;
  return new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    auth: { kind: "basic", email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN },
  });
}

/** Build a {@link JiraQueueConfig} from env. JQL has a sensible default. */
export function buildQueueFromEnv(): JiraQueueConfig {
  return {
    jql:
      env.JIRA_QUEUE_JQL ??
      (env.JIRA_PROJECT_KEY
        ? `project = ${env.JIRA_PROJECT_KEY} AND status = "Waiting for triage"`
        : 'status = "Waiting for triage"'),
    resolveTransitionId: env.JIRA_RESOLVE_TRANSITION_ID,
    deferTransitionId: env.JIRA_DEFER_TRANSITION_ID,
  };
}
