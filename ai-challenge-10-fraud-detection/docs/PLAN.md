# Implementation Plan

Phases run in order. Each phase ends with `npm run typecheck` and `npm test` passing. Design is in [DATA_DESIGN.md](DATA_DESIGN.md); interpretation choices are in [DECISIONS.md](DECISIONS.md).

## Phase 0 — Setup (done)

- Created `package.json` scripts, strict `tsconfig.json`, vitest and tsx.
- Wrote `src/types.ts`.
- Added `config/*.json` and `src/config.ts`. The config loader reports every missing or invalid key by its path.
- Wrote `src/csv.ts`, an RFC 4180 claims reader and writer.
- Wrote `src/stats.ts` for leave-one-out mean and sample SD (Decision 15).

## Phase 1 — Generator (done) and inspect (done, see Decision 21)

- **`npm run generate`:** a seeded PRNG builds `data/claims.csv` and `data/labels.csv` following DATA_DESIGN.md. The seed is a CLI argument and is also used for the holdout run.
- **`npm run inspect`** (`src/inspect.ts`, done) prints the known tells of the synthetic data (Decision 21): mean claim_id rank, share of amounts divisible by 100, weekend and inpatient share, diagnosis + procedure combinations never seen on clean claims (per fraud type), clean claims in the clustering band, and clean same member + diagnosis pairs 1–7 days apart. It prints and does not fail.
- The sanity checks originally planned for inspect, and where each one lives now:
  - 2,000 claims, 200 labeled fraud and the per-pattern counts: enforced by `src/generate/verify.ts`, which stops the generator. About 500 members and 50 providers: printed by `npm run generate`, not enforced.
  - no clean amount in 47,500–49,999: printed by inspect, not enforced.
  - weekday-only providers have no clean weekend claims; every provider that receives weekend injections has ≥ 30 surgical claims: enforced by `verify.ts`.
  - no label leakage through `claim_id` order or amount roundness: printed by inspect, not enforced. Mild tells remain (Decision 21).
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

## Phase 3 — Scoring (done)

- Composite score = weighted sum of fired rules normalized to 0–100 (Decision 20), with weights from config.
- A claim is flagged when its score > 0 (Decision 9).
- `npm run score` (`src/score.ts`) writes `output/scored.json` (flagged claims, in the brief's per-claim shape), `output/ranked.csv` (every claim with score, priority and rule names) and `output/score-stats.json` (timing and upcoding skips, no labels).
- 2,000 claims must be processed in < 30 s.

## Phase 4 — Report

- **`npm run report`** (`src/metrics.ts`, the only module that reads `data/labels.csv`) writes `output/metrics.md` (done):
  - confusion matrix, precision, recall, FPR (FP / (FP + TN)) and F1 at score > 0;
  - a threshold sweep at 1, 10, 20, …, 90, and precision@50/100/200;
  - a per-rule and per-pattern breakdown;
  - the number of claims skipped by upcoding, and the scoring time.
- Still to do: list the known false positives from Decision 5.
- **Holdout (done):** `npm run all -- --seed 7 --out data/holdout` writes the dataset to `data/holdout` and results to `output/holdout`, with the config untouched. A seed 42 vs seed 7 table (precision, recall, FPR, F1, precision@100) sits at the top of both `metrics.md` files; a gap above 5 pp is marked, and a config-hash mismatch is flagged as not a clean holdout.
- **Holdout:** a run on a second seed with no tuning (Decision 11).

## Phase 5 — README and submission

- Cover how to run the project, weight justification, results, and limitations, including Decision 12's synthetic-data assumption.
- Commit the dataset, scored output and report.

## Resolved items

1. **Clustering vs upcoding on K35.80 [P-1007, B-9002].** Resolved by Decision 16: the combination is removed, and clustering bases need a measured mean + 2 SD ≥ 50,500.
2. **Surgical volume.** Resolved by Decision 17: about 25% surgical claims. 12 heavy scheduled-surgery hospitals get 30 surgical claims each; every other hospital has fewer than 20.
3. **Base-claim reuse and row count.**
   - 1,800 clean claims are generated first. All 200 fraudulent claims are new rows, so clean claims stay clean.
   - A clean claim is the base of at most one injection. Fraudulent claims are never bases.
   - Phantom is the only pattern that changes clean claims: it moves their date. Moved claims and claims on the phantom provider-day are not used as bases.
4. **Upcoding mutual masking.**
   - Upcoded amounts are set to the clean mean + z × clean SD, with z drawn from [3, 4.5].
   - One upcoded claim per combination with ≥ 20 clean claims. A second claim goes only to combinations with ≥ 85 clean claims.
   - The first design used z in [3, 6] with any 2 per combination. It failed the z ≥ 2.5 check on 6 of 50 seeds: in a group of about 45, a partner at z = 6 pulled a z = 3 claim down to about 2.4.
   - The generator checks that every upcoded claim has a leave-one-out z ≥ 2.5 on the final dataset.
5. **SD = 0.**
   - Rule: a claim whose leave-one-out SD is 0 is not evaluated and is counted as skipped.
   - Generator: checks that every combination with ≥ 11 claims has SD > 0.
6. **Overlapping patterns.** Each fraudulent claim has exactly one `fraud_type` and is built to fire only its own rule where this can be controlled.
   - Injected claims with "normal" amounts use the same amount sampler as clean claims. A few of them may naturally exceed 2 SD, at the same rate as clean claims.
   - This is accepted, because suppressing it would itself reveal the label. The report lists claims fired by more than one rule.
7. **Score normalization and priority bands.** Resolved by Decision 20: saturating exponential with saturation 4; High ≥ 70, Medium 50–69, Low 1–49.
