# Use of AI

A short summary report of how I used Cursor, and the coding assistant behind it, to help me build the Nova agentic platform.

## A spec-driven approach

The way I worked on this was deliberately spec-driven rather than "prompt and hope". I did not start by asking the assistant to write code. I started from the data model. The whole thing began as a database design in Excel, `design-planning/nova-DBschemaV1.xlsx`, where I laid out the entities, relationships, and the shape of the data the platform would need to operate on: users and RBAC, customers and products, sales, customer issues and their action workflows, SOPs, conversations and messages. Having that schema settled up front gave me a stable foundation that everything else could be derived from, and it meant the assistant was never the one inventing the core domain.

From that schema I moved into writing specifications. This part was partially manual and partially done with the help of AI: I would sketch the intent and the constraints myself, then use the assistant to expand, tighten, and structure them into well-targeted spec files. Those specs (the planning documents under `design-planning/`, things like the database build prompt, the SQL analyst agent plan, the Celery worker plan, the observability and shared-state designs) became the actual instrument I used to drive execution. Instead of steering the coding assistant turn by turn with loose instructions, I pointed it at a precise, self-contained spec and let it implement against that. A good example is the database spec, where I even folded in the typo corrections and the explicit rules (no `synchronize: true`, no passwords in Postgres, snake_case in the DB and camelCase in TypeScript) so the assistant had no room to drift on the details that mattered.

## Establishing the rules before writing code

Before executing anything, I spent real time setting up the guardrails. I wrote a proper set of Cursor skills (the `secure-production-engineering` skill and its supporting resources) and an `AGENTS.md` file to establish my security and coding standards, the rules I expected to be followed, and the behaviours I wanted from the assistant. That covered the non-negotiables for this platform: secure by design, default deny and least privilege, centralized authentication and authorization with no ad hoc route-level checks, never trusting the frontend as a security control, strong typing and runtime validation at every trust boundary, no secrets or PII in logs, prompts, or traces, and tests for anything security-sensitive.

Doing this first paid off. Once those standards existed as skills and an agents file, the assistant carried them into its work by default, and I did not have to keep re-explaining the same constraints in every conversation. It also gave me a fixed reference to review its output against, rather than judging each change on instinct.

## Reviewing and correcting every output

I did not take any AI output at face value. I read and analysed every single thing it produced and corrected it whenever it carried over a wrong assumption or executed the wrong way. A couple of patterns came up repeatedly.

One was the assistant being too conservative with data: it had a tendency to reduce or trim down seed data and result sets, simplifying away things that the platform genuinely needed to be usable, and I had to push back and restore the proper scope.

Another, more important one, was on the agent layer. Left to itself the assistant would sometimes simplify the agent development in ways that diverged from the A2A standard. I had specifically designed the execution plane around A2A and LangGraph agents, so when it cut corners or drifted from that protocol I had to catch it and rectify the implementation back to the standard. Because I had the specs and the skills in place, these corrections were targeted rather than open-ended, and I could point directly at the rule that was being broken.

## What I took away from it

Overall I found the coding assistant genuinely good at the act of coding. The quality of what it writes, once it understands the target, is high. The real work is in the steering. The model needs attention to make sure it takes the right path and stays calibrated, neither too lazy (over-simplifying, dropping scope, taking the easy route) nor too verbose (over-engineering or padding things out beyond what was asked). My job through this project was less about typing code and more about being the one who holds the design, the standards, and the judgement: defining the schema, writing the specs, setting the rules up front, and then reviewing the output closely and correcting course whenever the assistant's assumptions or execution went the wrong way.

That combination, a clear spec-driven foundation plus close human review, is what let me use AI heavily on this platform while keeping it secure, typed, and faithful to the architecture I intended.
