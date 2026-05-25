/**
 * JIRA project creation — `POST /rest/api/3/project`.
 *
 * Required for the seed flow: the user has a fresh Atlassian account but no
 * project to put tickets into. Calling this from a script is faster than
 * clicking through the JIRA UI and gets us a known project key the agent
 * already has in its env.
 *
 * Caveat: project creation requires SITE ADMIN privileges on the JIRA site.
 * The Atlassian account that originally created the site is the admin by
 * default; regular users get 403. The CLI surfaces that error clearly.
 */
import type { JiraClient } from "./client";
import { getCurrentUser } from "./users";

/**
 * Template aliases → the cryptic `projectTypeKey` + `projectTemplateKey` pair
 * Jira actually expects. We expose the friendlier name so the CLI can do
 * `--template itsm` instead of asking the user to know the URN.
 *
 * `kanban` is the default because it's the only template that's guaranteed
 * to work on every Jira Cloud site — the JSM templates need Jira Service
 * Management enabled, which not every free site has.
 */
const TEMPLATE_ALIASES = {
  kanban: {
    typeKey: "software",
    templateKey: "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic",
    description: "Software project, Kanban board. Default — works on any Jira Cloud site.",
  },
  scrum: {
    typeKey: "software",
    templateKey: "com.pyxis.greenhopper.jira:gh-simplified-scrum-classic",
    description: "Software project, Scrum board.",
  },
  itsm: {
    typeKey: "service_desk",
    templateKey: "com.atlassian.servicedesk:simplified-it-service-management",
    description: "Jira Service Management — IT service management. Matches the assignment's 'Service Desk' wording but requires JSM enabled on the site.",
  },
  helpdesk: {
    typeKey: "service_desk",
    templateKey: "com.atlassian.servicedesk:simplified-general-service-desk",
    description: "Jira Service Management — general helpdesk template.",
  },
  basic: {
    typeKey: "business",
    templateKey: "com.atlassian.jira-core-project-templates:jira-core-simplified-task-tracking",
    description: "Business project, simplest task tracking.",
  },
} as const;

export type TemplateAlias = keyof typeof TEMPLATE_ALIASES;

export interface CreateProjectInput {
  /** 2-10 uppercase letters/digits, must start with a letter. Becomes the JIRA project key. */
  key: string;
  name: string;
  /** Friendly preset that resolves typeKey + templateKey. Default: "kanban". */
  template?: TemplateAlias;
  /** Override the resolved typeKey from `template`. Advanced. */
  projectTypeKey?: string;
  /** Override the resolved templateKey from `template`. Advanced. */
  projectTemplateKey?: string;
  /** Defaults to the authenticated user (via getCurrentUser). */
  leadAccountId?: string;
  description?: string;
  /** "PROJECT_LEAD" or "UNASSIGNED" — default UNASSIGNED so tickets sit in the queue. */
  assigneeType?: "PROJECT_LEAD" | "UNASSIGNED";
}

/**
 * The slice of the create-project response we care about. JIRA returns more
 * than this; we surface just the fields needed to follow up (e.g. update env,
 * link to UI).
 */
export interface JiraProjectCreateResult {
  id: number;
  key: string;
  self: string;
}

export async function createProject(
  client: JiraClient,
  input: CreateProjectInput,
): Promise<JiraProjectCreateResult> {
  const alias = input.template ?? "kanban";
  const tpl = TEMPLATE_ALIASES[alias];
  if (!tpl) {
    throw new Error(
      `Unknown template alias "${alias}". Valid: ${Object.keys(TEMPLATE_ALIASES).join(", ")}`,
    );
  }

  // Resolving the lead lazily means callers don't have to look up their own
  // accountId — just have a working API token and we figure the rest out.
  const leadAccountId = input.leadAccountId ?? (await getCurrentUser(client)).accountId;

  const body = {
    key: input.key,
    name: input.name,
    projectTypeKey: input.projectTypeKey ?? tpl.typeKey,
    projectTemplateKey: input.projectTemplateKey ?? tpl.templateKey,
    leadAccountId,
    description: input.description,
    assigneeType: input.assigneeType ?? "UNASSIGNED",
  };

  return client.request<JiraProjectCreateResult>(client.apiPath("/project"), {
    method: "POST",
    body,
  });
}

/** Surfaces the alias list for the CLI's --help and for any future UI. */
export function listTemplates(): Array<{ alias: TemplateAlias; description: string }> {
  return (Object.keys(TEMPLATE_ALIASES) as TemplateAlias[]).map((alias) => ({
    alias,
    description: TEMPLATE_ALIASES[alias].description,
  }));
}

/**
 * Cheap up-front validation — JIRA's own error for a bad key is cryptic
 * ("400: project key is invalid"), so we fail with a useful message before
 * the network call.
 */
export function validateProjectKey(key: string): void {
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
    throw new Error(
      `Invalid JIRA project key "${key}". Must be 2-10 chars, uppercase letters and digits, starting with a letter.`,
    );
  }
}
