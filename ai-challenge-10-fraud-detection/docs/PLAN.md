# Implementation Plan

Phases run in order. Each phase ends with `npm run typecheck` and `npm test` passing. Design is in [DATA_DESIGN.md](DATA_DESIGN.md); interpretation choices are in [DECISIONS.md](DECISIONS.md).

## Phase 0 — Setup (done)

- Created `package.json` scripts, strict `tsconfig.json`, vitest and tsx.
- Wrote `src/types.ts`.
- Added `config/*.json` and `src/config.ts`. The config loader reports every missing or invalid key by its path.
- Wrote `src/csv.ts`, an RFC 4180 claims reader and writer.
- Wrote `src/stats.ts` for leave-one-out mean and sample SD (Decision 15).

## Phase 1 — Generator and inspect

- **`npm run generate`:** a seeded PRNG builds `data/claims.csv` and `data/labels.csv` following DATA_DESIGN.md. The seed is a CLI argument and is also used for the holdout run.
- **`npm run inspect`:** sanity checks that fail loudly:
  - 2,000 claims, 200 labeled fraud, the per-pattern counts, and about 500 members and 50 providers;
  - no clean amount in 47,500–49,999;
  - weekday-only providers have no clean weekend claims; every provider that receives weekend injections has ≥ 30 surgical claims;
  - no label leakage: `claim_id` order and amount roundness do not separate fraud from clean claims.
- Rapid copies only use originals that have at least one weekday offset in 1..7 that stays within 2024.

## Phase 2 — Rules

- Write 8 pure functions `(claim, RuleContext) → Flag | null` in `src/rules/`, using thresholds from config.
- Each evidence string includes the actual numbers.
- Tests: at least 15, covering each rule and every boundary fixed in DECISIONS.md:
  - 30 vs 31 claims per provider-day;
  - gaps of 0, 1, 7 and 8 days;
  - amounts 47,499, 47,500, 49,999 and 50,000;
  - 10 vs 9 other claims for upcoding;
  - weekend share just below and just above 5%;
  - a partial bundle;
  - an unmapped diagnosis.

## Phase 3 — Scoring

- Composite score = weighted sum of fired rules normalized to 0–100, with weights from config.
- A claim is flagged when its score > 0 (Decision 9).
- `npm run score` writes the ranked output to `data/scored.json`.
- 2,000 claims must be processed in < 30 s.

## Phase 4 — Report

- **`npm run report`:**
  - precision, recall and FPR (FP / (FP + TN)), plus precision@K;
  - a per-rule and per-pattern breakdown;
  - the number of claims skipped by upcoding;
  - the known false positives from Decision 5.
- **Holdout:** a run on a second seed with no tuning (Decision 11).

## Phase 5 — README and submission

- Cover how to run the project, weight justification, results, and limitations, including Decision 12's synthetic-data assumption.
- Commit the dataset, scored output and report.

## Open items (need a decision before or during Phase 1)

1. **Clustering vs upcoding on K35.80 [P-1007, B-9002].** This combination meets Decision 12 (mean ≈ 38,100, SD ≈ 5,250), but mean + 2 SD ≈ 48,600. Clustering amounts from about 48,600 to 49,999 would therefore also fire upcoding. The condition is not lowered; whether to tighten it is undecided.
2. **Surgical volume.** Only 3 of the 15 diagnoses are surgical. With a uniform diagnosis mix, that gives ≈ 380 surgical claims, or ≈ 13 per hospital across 30 hospitals. Decision 14 needs ≥ 30 at each injected scheduled hospital: at least 10 hospitals × 30 = 300 surgical claims there. The diagnosis mix and provider allocation must be weighted to reach this.
3. **Base-claim reuse and row count.**
   - Can one clean claim be the base for several injections?
   - Copy- and add-style patterns create new rows (30 + 30 + 25 + 20 = 105), so about 1,895 base claims are needed for a total of 2,000.
4. **Upcoding mutual masking.** Several upcoded claims in one group inflate each other's leave-one-out SD, and a factor near 1.35 may give z < 2. How upcoded claims are spread across groups is undecided.
5. **SD = 0.** Behavior when every reference claim has the same amount.
6. **Score normalization and priority bands.** What the score is divided by, and the High/Medium/Low cut-offs.
7. **Overlapping patterns.** An unbundled K35.80 [P-1008, P-2001, P-2002] has a reference total of 47,000 and may land in the clustering band. Undecided whether labels record one fraud type or several.
