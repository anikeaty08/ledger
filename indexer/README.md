# @ledger/indexer

[Ponder](https://ponder.sh) indexer for the Ledger contracts. Builds a queryable read model (GraphQL +
SQL over Postgres) from `InvoiceCreated`, `InvoiceAccepted`, `PaymentRecorded`, `AdvanceFunded`,
`AdvanceDefaulted`, `InvoicePaid`, and the other events in `contracts/src/**`. This is a **read model
only** — the chain stays the source of truth, and `apps/api`'s own state-changing routes re-read the
chain directly rather than trusting these tables (see `docs/SYSTEM_DESIGN.md` §16).

## Setup

```bash
npm install
cp .env.example .env.local
# fill in the deployed addresses from contracts/deployments/<chainId>.json
npx ponder dev     # local dev server with hot reload + GraphQL playground
npx ponder start   # production
```

## Schema

`ponder.schema.ts` defines five tables: `invoice`, `advance`, `payment`, `status_change`, `dispute`, and
`ledger_account`. `InvoiceStatus` values are the same enum ordinals as
`contracts/src/libraries/Types.sol` (0 None … 9 Cancelled) — kept in a comment at the top of the schema
file so they don't drift silently if the contract enum ever changes order.

Handlers live in `src/*.ts`, one file per indexed contract, and are intentionally simple upserts — no
derived aggregation happens here (an aggregation/materialized-view layer would sit on top of this if
volume ever demands it, out of scope for the hackathon).

## Verification status (please read before relying on this)

- `ponder codegen` **did** catch and let me fix one real bug in `ponder.schema.ts` (a `many()` relation
  with no matching reverse side), confirming the config, schema, and the event names referenced in
  `src/*.ts` against the ABIs in `abis/*.json` all parsed correctly as of that run.
- After that fix, `ponder codegen` / `ponder dev` could not be run to a clean, confirmed-successful
  finish in this environment — every subsequent invocation printed only `Failed to find Response
  internal state key` and exited without writing any output, which is a known symptom of Ponder's
  bundled `undici` HTTP client conflicting with very new Node versions (this environment runs **Node
  v24.14**; Ponder's own `engines` field only guarantees `>=18.14`, and its dependency chain hasn't
  caught up to 24.x yet as of writing). This is an environment/tooling mismatch, not something fixable
  by editing this package's source.
- **Before relying on this in Wave 1:** run it under **Node 20 or 22 LTS** (`nvm use 20`) and confirm
  `npx ponder dev` starts cleanly against real deployed addresses. I was not able to do that final check
  here.
