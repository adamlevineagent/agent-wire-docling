# frontend/

Next.js 15 + React 19 + TypeScript + Tailwind + TanStack Query. Dark mode default.

## Setup

```bash
cd frontend
pnpm install
pnpm codegen       # generates lib/api-types.ts from ../contracts/openapi.yaml
pnpm dev           # http://localhost:3000 (API proxy /api/* → :8000)
```

## Scripts

- `pnpm dev` — Next dev server
- `pnpm build` / `pnpm start` — production
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm codegen` — regenerate API types from openapi.yaml
- `pnpm lint` — Next lint

## Layout

```
frontend/
├── app/                    Next App Router pages
│   ├── layout.tsx          Dark mode, global styles
│   ├── page.tsx            Shell (Agent D replaces the scaffold)
│   └── globals.css         Base styles
├── components/
│   ├── shell/              Agent D: layout + sidebar + topbar + shortcut manager
│   ├── VizDiff/            Agent E: shared two-pane reviewer
│   ├── Renderers/          Agent E (pdf) + Agent F (others)
│   ├── TasteTest/          Agent G: sampling + approval UI
│   └── BatchRun/           Agent H: batch progress + post-run review
├── lib/
│   ├── api-types.ts        Codegen'd from ../contracts/openapi.yaml
│   ├── api-client.ts       Thin fetch wrapper using api-types
│   ├── shortcuts.ts        Agent D: scope manager (see ../contracts/shortcuts.ts)
│   └── query-client.ts     TanStack Query setup
├── tailwind.config.ts      Imports ../contracts/design-tokens.ts
└── package.json
```

## Conventions

- All HTTP types come from `lib/api-types.ts` (codegen'd). Don't hand-write HTTP types.
- All design tokens come from `../contracts/design-tokens.ts`. No hardcoded colors/spacing.
- Shortcuts use `useShortcutScope` from `lib/shortcuts.ts` per `../contracts/shortcuts.ts`.
- Dark mode only — no light mode toggle.
- Commit only after `pnpm typecheck` and `pnpm dev` boot cleanly.
