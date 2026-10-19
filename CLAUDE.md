# DÖSE platform

DÖSE's own commerce platform: an Astro storefront, a React admin and a narrow TypeScript commerce core on Cloudflare Workers, with Postgres on Neon.

## Read these first, every session

Before doing any work, read in this order:

1. `docs/master-plan.md` — the approved master plan. It is final.
2. `docs/progress.md` — what has been done, what is in flight, what is next.
3. `docs/milestones.md` — the milestone map from Milestone 1 to launch.
4. `docs/decisions/` — every recorded decision (one file per decision).
5. `docs/plans/` — the detailed plan for the current milestone.

## Rules

- **Never reopen a recorded decision without new evidence.** The master plan and the records in `docs/decisions/` are settled. Do not brainstorm alternatives to them, re-litigate them, or quietly work around them. If new evidence (a measurement, a vendor answer, a legal opinion, a failing test) contradicts a decision, stop, write down the evidence, and ask the owner before changing course. A change of decision is itself a new record in `docs/decisions/` that names the record it supersedes.
- **Beliefs are not facts.** Items the master plan marks as beliefs, assumptions or "not yet verified" are verified before code that depends on them is merged. Record the result.
- **Do not act outside the repository without the owner's approval:** no cloud or vendor accounts created, no changes to doseeg.com or its DNS, no payment (Paymob) or shipping (Bosta) accounts connected, no real customer data collected.
- **Keep `docs/progress.md` current.** At the end of each working session, add a dated entry: what changed, what was verified, what is blocked and on whom.
- **Record decisions as you make them.** Use `docs/decisions/NNNN-short-title.md` with: status, date, context, decision, consequences, and the evidence it rests on.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
