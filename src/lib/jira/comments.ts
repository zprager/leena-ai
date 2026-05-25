/**
 * Comments and labels on JIRA issues.
 *
 * Comments are written as ADF (Atlassian Document Format) on the v3 API. Our
 * `formatComment()` produces lightweight Markdown — we convert it to a minimal
 * ADF tree (paragraphs split by blank lines, with inline bold/code marks).
 * It's deliberately small; bring a richer renderer if you need full Markdown.
 */
import { JiraClient } from "./client";
import type { JiraComment } from "./types";

/**
 * Post a comment on an issue. Accepts a Markdown-ish string (what
 * `formatComment()` produces) and serializes it to ADF for the v3 API. For v2,
 * the body is sent as a plain string instead.
 */
export async function postComment(
  client: JiraClient,
  issueKey: string,
  body: string,
): Promise<JiraComment> {
  const payload = client.apiVersion === "3" ? { body: markdownToAdf(body) } : { body };

  const res = await client.request<RawJiraComment>(
    client.apiPath(`/issue/${encodeURIComponent(issueKey)}/comment`),
    { method: "POST", body: payload },
  );

  return {
    id: res.id,
    body, // echo back the source we sent — easier for callers than re-flattening ADF
    created: res.created ?? "",
    author: res.author
      ? { accountId: res.author.accountId, displayName: res.author.displayName }
      : undefined,
  };
}

/**
 * Add labels to an issue (additive — won't remove existing ones). JIRA doesn't
 * have a dedicated "add label" endpoint; we use the field-update PATCH with
 * the `add` array operation, which is atomic and idempotent.
 */
export async function addLabels(
  client: JiraClient,
  issueKey: string,
  labels: string[],
): Promise<void> {
  if (labels.length === 0) return;
  await client.request<void>(client.apiPath(`/issue/${encodeURIComponent(issueKey)}`), {
    method: "PUT",
    body: {
      update: {
        labels: labels.map((value) => ({ add: value })),
      },
    },
  });
}

// ---------- Markdown → ADF (minimal) ----------

interface AdfMark {
  type: string;
}

interface AdfTextNode {
  type: "text";
  text: string;
  marks?: AdfMark[];
}

interface AdfParagraph {
  type: "paragraph";
  content: AdfTextNode[];
}

interface AdfDoc {
  type: "doc";
  version: 1;
  content: AdfParagraph[];
}

/**
 * Tiny Markdown → ADF converter. Handles paragraphs (blank-line separated),
 * inline `**bold**` and `` `code` ``, and `_italic_`. Anything else is emitted
 * as plain text. Good enough for the agent's comment template; swap in a real
 * Markdown parser if your prompts grow richer.
 */
export function markdownToAdf(markdown: string): AdfDoc {
  const paragraphs = markdown.split(/\n\s*\n/);
  const content: AdfParagraph[] = paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map<AdfParagraph>((p) => ({
      type: "paragraph",
      content: parseInline(p),
    }));

  // ADF requires at least one node — if the input was empty, emit an empty paragraph.
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [] });
  }

  return { type: "doc", version: 1, content };
}

// Matches **bold**, _italic_, or `code`. Ordering inside the alternation is
// significant — `**` must precede `_` so we don't mistake `**_x_**` for italics.
const INLINE_RE = /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`)/g;

function parseInline(text: string): AdfTextNode[] {
  const nodes: AdfTextNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const matchStart = match.index ?? 0;
    if (matchStart > lastIndex) {
      pushText(nodes, text.slice(lastIndex, matchStart));
    }
    if (match[2] !== undefined) pushText(nodes, match[2], [{ type: "strong" }]);
    else if (match[3] !== undefined) pushText(nodes, match[3], [{ type: "em" }]);
    else if (match[4] !== undefined) pushText(nodes, match[4], [{ type: "code" }]);
    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < text.length) pushText(nodes, text.slice(lastIndex));
  return nodes;
}

function pushText(nodes: AdfTextNode[], text: string, marks?: AdfMark[]): void {
  if (!text) return;
  // ADF text nodes can't contain newlines; convert them to hardBreaks would be
  // ideal, but for our short comments collapsing to spaces reads fine.
  const sanitized = text.replace(/\n/g, " ");
  if (marks && marks.length) nodes.push({ type: "text", text: sanitized, marks });
  else nodes.push({ type: "text", text: sanitized });
}

// ---------- Raw response shapes ----------

interface RawJiraComment {
  id: string;
  created?: string;
  author?: {
    accountId: string;
    displayName: string;
  };
}
