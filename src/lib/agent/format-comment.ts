import { REASON_CODE_META } from "./reason-codes";
import type { TriageDecision } from "./schema";

/**
 * Render the agent's decision as the body of a JIRA comment.
 * - RESOLVE → user-facing answer with the citation as a source line.
 * - DEFER  → structured "needs human" block: reason code badge, the agent's
 *            note, and the routing hint pulled from REASON_CODE_META.
 *
 * The JIRA layer is responsible for posting this. We don't talk to JIRA here
 * so the agent stays testable as a pure function.
 */
export function formatComment(decision: TriageDecision): string {
  if (decision.action === "RESOLVE") {
    return `${decision.answer}\n\n_Source: ${decision.citation}_`;
  }

  const meta = REASON_CODE_META[decision.reasonCode];
  return [
    `🤖 **Needs human review** — \`${decision.reasonCode}\``,
    "",
    decision.note,
    "",
    `_Why: ${meta.description}_`,
    `_Suggested routing: ${meta.routeTo}_`,
  ].join("\n");
}

/**
 * Labels to attach to the JIRA ticket. Lets queue dashboards filter by
 * "agent-resolved" vs. "agent-deferred" and drill in by reason code.
 */
export function jiraLabels(decision: TriageDecision): string[] {
  if (decision.action === "RESOLVE") return ["agent-resolved"];
  return [
    "agent-deferred",
    `defer-${decision.reasonCode.toLowerCase().replace(/_/g, "-")}`,
  ];
}
