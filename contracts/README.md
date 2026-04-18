# contracts/

Frozen API and interface shapes. Every Wave 1/2 agent codes against these files; anyone finding a gap files it in `plans/deferral-ledger.md` and escalates rather than silently editing.

## Files

| File | Owner | Consumers | Purpose |
|---|---|---|---|
| [`openapi.yaml`](./openapi.yaml) | backend | backend (A/B/C implement endpoints), frontend (D codegens client) | Full HTTP surface. Source of truth for all request/response shapes. |
| [`vizdiff.ts`](./vizdiff.ts) | frontend Agent E | Agents E, F, G, H | `<VizDiff />` props + `SourceRenderer` interface + review action types. |
| [`shortcuts.ts`](./shortcuts.ts) | frontend Agent D | Agents D, E, G, H | `useShortcutScope` hook API + default bindings per scope. |
| [`docling-types.ts`](./docling-types.ts) | frontend | Agents E, F | Minimal DoclingDocument + Anchor shape. Isolates us from upstream Docling schema drift. |
| [`design-tokens.ts`](./design-tokens.ts) | frontend Agent D | all frontend agents | Dark-first color palette, typography, spacing, component conventions. Imported into `tailwind.config.ts`. |
| [`db-schema.sql`](./db-schema.sql) | backend Agent C | Agents A, B, C | SQLite DDL. Agent C owns migrations; A and B read against the committed schema. |

## Codegen

Agent D's first commit runs:
```bash
pnpm dlx openapi-typescript contracts/openapi.yaml -o frontend/lib/api-types.ts
```

All HTTP-shape frontend types (DocMeta, Manifest, TasteSession, Job, etc.) come from the generated file. The hand-written `.ts` files in this folder are ONLY for:
- UI-layer types not in the HTTP surface (VizDiff props, shortcut scope)
- Frontend's narrow view of external libraries (DoclingDocument subset)
- Design tokens (Tailwind config input)

## Changing a contract

Mid-wave contract changes cause drift. Protocol:
1. Open a note in `plans/deferral-ledger.md` describing what's needed and why.
2. Ping the conductor (me). Don't edit the contract yourself.
3. Conductor edits, re-runs codegen, broadcasts to affected agents.

## Verification

After P3 scaffold:
- `pnpm typecheck` in `frontend/` passes against the generated types
- `ruff check` + `pytest` in `backend/` pass against the committed endpoint stubs
- `scripts/start.sh` launches both servers; `GET /openapi.json` returns the spec
