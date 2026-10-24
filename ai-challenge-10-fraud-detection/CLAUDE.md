# Fraud Detection Scoring Engine

Rule-based fraud scoring engine for insurance claims (AI Challenge 10, see `docs/BRIEF.md`). It generates a synthetic dataset of 2,000 claims with ~200 embedded fraud cases, runs 8 detection rules, assigns each claim a 0–100 risk score with itemized evidence, and reports precision/recall/FPR against the known labels. Interpretation choices are recorded in `docs/DECISIONS.md`.

## Commands

- `npm install` — install dependencies
- `npm run generate` — generate the synthetic dataset and labels
- `npm run inspect` — print dataset sanity stats
- `npm run score` — run rules and write scored output
- `npm run report` — compute metrics and write the report
- `npm run all` — generate → score → report; `npm run all -- --seed 7 --out data/holdout` runs the same pipeline on another seed, data in `data/holdout`, results in `output/holdout`, and adds a seed comparison to the top of both `metrics.md` files
- `npm test` — run unit tests
- `npm run typecheck` — `tsc --noEmit`

## Conventions

- TypeScript strict mode; no `any`.
- Dates are `'YYYY-MM-DD'` strings; compute day of week in UTC.
- Rules are pure functions.
- Thresholds and weights come from config, never hard-coded in rules.
- Evidence strings must contain the actual numbers (amounts, counts, z-scores, thresholds).
- Rules must never read fraud labels.
- Never modify a test just to make it pass.

## Language

- Code, comments, evidence strings and files in `docs/` are written in English.
- Reply to the user in chat in Vietnamese.

## Before reporting a task as done

Run `npm run typecheck` and `npm test`, and paste their output.
