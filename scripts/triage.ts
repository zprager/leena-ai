/**
 * Triage a single ticket from the CLI. Useful for spot-checking the agent
 * against the 50-sample tickets before building the full eval harness.
 *
 * Usage:
 *   npm run triage -- "I forgot my password and got locked out after 3 tries. How many more attempts?"
 *   npm run triage -- --multi-query "is what I'm doing allowed"
 *   npm run triage -- --provider openai "..."
 *   npm run triage -- --verbose "..."   # also print retrieval + raw LLM output
 */
import { triage, formatComment, jiraLabels } from "@/lib/agent";
import type { LLMProvider } from "@/lib/llm";

// ---------- CLI ----------

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const out: {
    ticket: string;
    multiQuery: boolean;
    rerank: boolean;
    verbose: boolean;
    provider?: LLMProvider;
  } = { ticket: "", multiQuery: false, rerank: false, verbose: false };
  // Collect every non-flag arg and join with spaces, so unquoted multi-word
  // tickets (`npm run triage -- forgot my password`) work without surprise.
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--multi-query") out.multiQuery = true;
    else if (a === "--rerank") out.rerank = true;
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--provider") {
      const v = args[++i];
      if (v !== "anthropic" && v !== "openai") {
        throw new Error(`--provider must be anthropic|openai, got "${v}"`);
      }
      out.provider = v;
    } else positional.push(a);
  }
  out.ticket = positional.join(" ").trim();
  return out;
}

// ---------- Main ----------

async function main() {
  const { ticket, multiQuery, rerank, verbose, provider } = parseArgs(process.argv);
  if (!ticket) {
    console.error(
      'usage: npm run triage -- [--multi-query] [--rerank] [--verbose] [--provider anthropic|openai] "ticket body"',
    );
    process.exit(1);
  }

  const result = await triage(ticket, { multiQuery, rerank, provider });

  console.log("=== Ticket ===");
  console.log(ticket);
  console.log();

  // --verbose surfaces the two things you actually need when debugging a bad
  // decision: what the retriever pulled (top score + hits), and what the LLM
  // produced before schema normalization. Hidden by default to keep the happy
  // path readable.
  if (verbose) {
    console.log("=== Retrieval ===");
    const r = result.trace.retrieval;
    console.log(
      `top score: ${r.topScore.toFixed(3)}${r.belowThreshold ? "  (BELOW THRESHOLD)" : ""}`,
    );
    if (r.queriesUsed.length > 1) {
      console.log(`paraphrases: ${r.queriesUsed.slice(1).join(" | ")}`);
    }
    for (const h of r.hits.slice(0, 5)) {
      console.log(`  [${h.score.toFixed(3)}] ${h.citation}  ${h.policyTitle}`);
    }
    console.log();
    console.log("=== Raw LLM output ===");
    console.log(JSON.stringify(result.trace.rawOutput, null, 2));
    console.log();
  }

  console.log("=== Decision ===");
  console.log(`action: ${result.decision.action}`);
  if (result.decision.action === "RESOLVE") {
    console.log(`citation: ${result.decision.citation}`);
  } else {
    console.log(`reasonCode: ${result.decision.reasonCode}`);
  }
  console.log(`reasoning: ${result.decision.reasoning}`);
  // Surface post-validation overrides — when the LLM said RESOLVE but a guard
  // (ungrounded citation, below-threshold score) flipped it to DEFER. Critical
  // signal when calibrating the threshold or debugging "why didn't it resolve?"
  if (result.trace.downgraded) {
    console.log(
      `↓ downgraded from ${result.trace.downgraded.from}: ${result.trace.downgraded.reason}`,
    );
  }
  console.log(`(${result.trace.durationMs}ms)`);
  console.log();

  // The two artifacts a human operator would actually paste into JIRA — shown
  // last so the eye lands on them after the reasoning that justifies them.
  console.log("=== JIRA comment ===");
  console.log(formatComment(result.decision));
  console.log();
  console.log(`labels: ${jiraLabels(result.decision).join(", ")}`);
}

main().catch((err) => {
  console.error("[triage] failed:", err);
  process.exit(1);
});
