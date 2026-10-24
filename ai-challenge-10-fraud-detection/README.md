# Fraud Detection Scoring Engine

A rule-based engine that scores insurance claims for fraud. It generates a synthetic dataset of 2,000 claims with 200 injected fraud cases, runs 8 rules, gives each claim a 0–100 risk score with evidence, and measures precision, recall and FPR against the known labels. Brief: [docs/BRIEF.md](docs/BRIEF.md).

## 1. Results at a glance

Source: [output/metrics.md](output/metrics.md) (seed 42) and [output/holdout/metrics.md](output/holdout/metrics.md) (seed 7). Same code and config for both runs, no tuning in between. Flagged = score > 0 ([Decision 9](docs/DECISIONS.md#9-what-counts-as-flagged-for-metrics)). Each dataset has 2,000 claims: 200 labeled fraud, 1,800 clean.

| Metric | seed 42 | seed 7 (holdout) |
| :--- | ---: | ---: |
| Precision | 79.4% | 80.3% |
| Recall | 100.0% | 100.0% |
| FPR | 2.9% | 2.7% |
| F1 | 88.5% | 89.1% |
| Precision@100 | 79.0% | 80.0% |
| Flagged claims | 252 | 249 |
| Rules + scoring + ranking, 2,000 claims | 30.8 ms | 30 ms |
| Including file read and write | 37.9 ms | 38.5 ms |

Tests: 189 passing in 20 files (`npm test`). The brief's limit is 30 s.

### How to read these metrics

- **Recall 100% is expected here, not an achievement.** The data is synthetic and every pattern is injected past its rule's threshold, using the same statistics and config the rule uses.
- **The 70% recall target is met only if "flagged" means score > 0.** If only Medium and above (score ≥ 50) counts, seed 42 recall is 65.0% (seed 7: 65.5%), because the three severity-2 patterns (70 of 200 claims) score 39 on their own.
- **The numbers that carry information are FPR and the upcoding precision.** FPR is about 3%. Upcoding precision is 41.8% on seed 42: it fired on 79 claims, 33 of them labeled fraud, so 46 clean claims were flagged by chance.
- **FPR is probably optimistic.** By design, clean claims have no revisits 1–7 days apart and no amounts in the clustering band ([Decisions 12 and 18](docs/DECISIONS.md#12-clean-amounts-avoid-the-clustering-band-clustering-only-on-high-cost-combinations-refined-by-decision-16)). Real data has both, so real FPR is likely higher.
- **Seed 7 only checks for overfitting to one seed.** It uses the same generator, so it cannot test the generator's own assumptions.
- **Unfamiliar (diagnosis, procedure) combinations in dx_procedure_mismatch and unbundling are a known tell** of the synthetic data. No rule uses it. `npm run inspect` prints it ([Decision 21](docs/DECISIONS.md#21-clean-data-stays-as-designed-perfect-recall-comes-from-how-the-data-is-built)).

## 2. Quickstart

Node ≥ 20.

```bash
npm ci
npm run all     # generate → score → report; writes data/ and output/
npm test        # unit tests
```

Other commands: `npm run typecheck`, `npm run inspect`. Holdout run: `npm run all -- --seed 7 --out data/holdout`.

## 3. Project structure

```
config/            thresholds, weights, procedures, bundles, diagnosis→procedure map (JSON)
data/              claims.csv and labels.csv for seed 42; holdout/ for seed 7
docs/              BRIEF, DATA_DESIGN, DECISIONS, PLAN, TIMELOG
output/            scored.json, ranked.csv, metrics.md, run summaries; holdout/ for seed 7
src/               pipeline, scoring, metrics, inspect, CSV and config I/O, shared helpers
src/generate/      seeded synthetic data generator and its self-checks
src/rules/         the 8 rules, one pure function per file
tests/             vitest tests; tests/rules/ has one file per rule
ai-conversation/   Claude Code session logs
```

## 4. How the data is generated

Details: [docs/DATA_DESIGN.md](docs/DATA_DESIGN.md). Everything comes from a seeded PRNG.

- **Clean claims (1,800):** 50 providers (15 hospitals open every day, 15 scheduled-surgery hospitals open Mon–Fri, 15 general clinics, 5 dental clinics) and a shared pool of 500 members. Claims follow fixed diagnosis protocols, so each procedure-code combination repeats often enough for statistics. Amount = sum of reference prices with about 15% lognormal noise.
- **Fraud claims (200):** added as new rows after the clean ones: duplicate 30, rapid re-submission 30, upcoding 30, unbundling 25, phantom billing 25, weekend anomaly 20, diagnosis–procedure mismatch 20, amount clustering 20.
- **Labels:** `claim_id` is assigned after shuffling and sorting by date, so fraud does not form an ID range. `claims.csv` has no label column. Only `src/metrics.ts` and `src/inspect.ts` read `labels.csv`.
- **Self-checks:** the generator stops if a count is off, an upcoded claim has z < 2.5, a clustering claim would also fire upcoding, or a weekday-only provider has a clean weekend claim.

## 5. The 8 rules

Each evidence string below is copied from [output/scored.json](output/scored.json).

| Rule | Logic | Evidence (one real example) |
| :--- | :--- | :--- |
| duplicate_claim | Same member, provider, date and diagnosis as an earlier claim. The lowest `claim_id` is the original; only later copies are flagged. | `Duplicate of CLM-01871: same member M-0196, provider PRV-33, date 2024-12-10, diagnosis K80.20; copy 2 of 2` |
| rapid_resubmission | Same member and diagnosis as the previous claim, 1–7 days earlier. Same-day repeats belong to duplicate. | `Same member M-0379 and diagnosis E11.9 as CLM-00017 (2024-01-03), resubmitted 6 days later (window 1–7 days)` |
| upcoding | Amount above mean + 2 SD of claims with the same procedure-code combination. Leave-one-out mean and sample SD; needs ≥ 10 other claims. | `Amount 64,440 for procedures B-9002+P-1008 has z = 3.30 (> 2): mean 44,855.15, SD 5,929.16 over 103 other claims with the same procedure codes, excluding this claim` |
| unbundling | The claim has every component of a bundle. If the bundle code is there too, the evidence says the services are billed twice. A bundle code alone is not flagged. | `Unbundling: components P-1002, P-1003, P-1004 are billed separately; bundle B-9001 (Basic blood panel) should be used (bundle price 1,000 vs itemized total 1,200)` |
| phantom_billing | A provider has more than 30 claims on one day. Every claim of that day is flagged. | `Provider PRV-25 submitted 31 claims on 2024-04-17 (limit 30); its average is 2.2 claims per active day (55 claims over 25 active days)` |
| weekend_anomaly | Surgical claim on a Saturday or Sunday at a provider whose weekend share of surgical claims is under 5%, with the claim itself excluded. Needs ≥ 20 surgical claims. | `Surgical procedure B-9002 (Appendectomy package) containing P-2001 (Appendectomy), P-2002 (Anesthesia) on Saturday 2024-01-13 at provider PRV-45, whose weekend share of surgical claims is 3.0% (1/33 surgical claims, excluding this claim), below the 5% limit` |
| dx_procedure_mismatch | A billed procedure is not valid for the claim's diagnosis in the map. Diagnoses missing from the map are not flagged. | `Diagnosis K08.1 (DENTAL) is billed with procedure P-1001 (Consultation) that it does not cover (1 of 1 billed procedures, claim amount 830). Valid procedures for K08.1 (2): P-3002 (Dental X-ray), P-3004 (Tooth extraction)` |
| amount_clustering | 47,500 ≤ amount < 50,000, just under the auto-approval threshold. | `Amount 49,110 is 98.2% of the 50,000 auto-approval threshold (flag band 47,500 ≤ amount < 50,000); typical amount for B-9002+P-1008 is 45,003.98 (mean of 103 other claims)` |

## 6. Scoring

Weights are in [config/thresholds.json](config/thresholds.json).

### Why these weights

| Rule | Weight | Reason |
| :--- | :---: | :--- |
| duplicate_claim | 5 | Clear violation, almost certain, direct financial loss. |
| phantom_billing | 5 | Same: clear violation, almost certain, direct financial loss. |
| upcoding | 4 | Real money, but the evidence is statistical, so a person should review it. |
| unbundling | 4 | Real money, but it depends on the bundle table, so a person should review it. |
| weekend_anomaly | 3 | Suspicious, but genuine emergency surgery happens on weekends. |
| rapid_resubmission | 2 | Weak alone: legitimate follow-up visits exist. |
| dx_procedure_mismatch | 2 | Weak alone: the diagnosis map is incomplete. |
| amount_clustering | 2 | Weak alone: an amount near the threshold is only a hint. |

### Formula and priority

- `raw` = sum of the weights of the claim's fired rules.
- `risk_score = round(100 × (1 − e^(−raw / 4)))`. A claim with any flag scores at least 1.
- Priority: High ≥ 70, Medium 50–69, Low 1–49 ([Decision 20](docs/DECISIONS.md#20-score-normalization-and-priority-bands)).
- A single rule scores 71 (weight 5), 63 (4), 53 (3) or 39 (2). Two weight-2 rules score 63; upcoding plus clustering scores 78.

**Why not divide by the maximum total weight?** The sum of all 8 weights is 27. A confirmed duplicate would then score 5/27, which rounds to 19, and no real claim would come near 100. Dividing by the highest raw sum in the dataset would make a claim's score depend on the other claims. The exponential form depends only on the claim's own flags and the config, with diminishing returns per extra flag.

**Why is "flagged" score > 0 while priority is separate?** Flagged means a rule fired, and that is what precision and recall measure ([Decision 9](docs/DECISIONS.md#9-what-counts-as-flagged-for-metrics)). Priority is a triage order for reviewers. Using 50 as the flag cut-off would drop the patterns detected only by weight-2 rules, and recall would fall to 65%. The threshold sweep in `metrics.md` shows both.

## 7. Decisions on ambiguities

All in [docs/DECISIONS.md](docs/DECISIONS.md).

1. [Duplicate](docs/DECISIONS.md#1-duplicate-claim--which-claim-is-flagged): the smallest `claim_id` is the original; only later copies are flagged.
2. [Rapid re-submission](docs/DECISIONS.md#2-rapid-re-submission--gap-window): gap of 1–7 days, so it does not overlap duplicate.
3. [Upcoding grouping](docs/DECISIONS.md#3-upcoding--grouping-and-statistics): group by procedure-code combination; leave-one-out mean and SD.
4. [Unbundling](docs/DECISIONS.md#4-unbundling--what-triggers-the-rule): flag when all components are present, with or without the bundle code.
5. [Phantom billing](docs/DECISIONS.md#5-phantom-billing--which-claims-are-flagged): flag every claim on a provider-day above 30; the ~6 clean claims that day are known false positives.
6. [Weekend share](docs/DECISIONS.md#6-weekend-anomaly--historical-weekend-share-refined-by-decision-19): excludes the claim being evaluated.
7. [Unmapped diagnoses](docs/DECISIONS.md#7-diagnosisprocedure-mismatch--unmapped-diagnoses): not flagged; bundle components count as valid.
8. [Clustering range](docs/DECISIONS.md#8-amount-clustering--range): 47,500 ≤ amount < 50,000, read from config.
9. [What "flagged" means](docs/DECISIONS.md#9-what-counts-as-flagged-for-metrics): score > 0.
10. [claim_id assignment](docs/DECISIONS.md#10-claim_id-assignment): after shuffling and sorting by date.
11. [Extra metrics and holdout](docs/DECISIONS.md#11-additional-metrics-and-holdout): precision, precision@K, and a seed-7 run.
12. [Clean amounts and clustering](docs/DECISIONS.md#12-clean-amounts-avoid-the-clustering-band-clustering-only-on-high-cost-combinations-refined-by-decision-16): clean amounts avoid the band; clustering is injected only on high-cost combinations.
13. [Rapid injection](docs/DECISIONS.md#13-rapid-re-submission--how-cases-are-injected): the fraud claim is always the later copy, non-surgical, on a weekday.
14. [Weekend volume](docs/DECISIONS.md#14-weekend-anomaly--provider-volume-and-surgical-definition): ≥ 30 surgical claims and ≤ 2 injections per provider; bundle components count as surgical; P-2005 is medical.
15. [Upcoding statistics](docs/DECISIONS.md#15-upcoding--statistics): sample SD; ≥ 10 other claims, so a group needs ≥ 11.
16. [Clustering bases](docs/DECISIONS.md#16-clustering--which-combinations-can-carry-a-clustering-claim): mean + 2 SD ≥ 50,500, so a clustering claim never fires upcoding.
17. [Surgical volume](docs/DECISIONS.md#17-surgical-volume-for-the-weekend-rule): about 25% of clean claims, concentrated in 12 hospitals.
18. [Clean spacing](docs/DECISIONS.md#18-rapid-re-submission--spacing-of-clean-claims): same member and diagnosis are ≥ 8 days apart, whatever the provider.
19. [Weekend share basis](docs/DECISIONS.md#19-weekend-anomaly--the-share-is-over-surgical-claims): over surgical claims, with the evaluated claim removed from both counts.
20. [Score normalization](docs/DECISIONS.md#20-score-normalization-and-priority-bands): saturating exponential and priority bands.
21. [Clean data stays as designed](docs/DECISIONS.md#21-clean-data-stays-as-designed-perfect-recall-comes-from-how-the-data-is-built): no noise added; perfect recall comes from how the data is built.

## 8. Known limitations and what I would do next

- **Upcoding groups by code combination.** Adding one cheap code moves a claim into a different group and avoids the rule. Groups with fewer than 11 claims are skipped (25 claims on both seeds). *Next:* price each procedure code separately, and fall back to a coarser group for small ones.
- **Weekend anomaly hides itself.** A provider with 3 or more injected weekend cases per ~30 surgical claims pushes its own share over 5% and none of them is flagged. Providers with fewer than 20 surgical claims are never evaluated, which includes new providers. *Next:* measure the share on a reference period without the weekend cases under test, and use a peer-group share for small providers.
- **Duplicate and rapid leave gaps.** Same member, diagnosis and date at different providers is caught by neither rule. Rapid also flags chronic patients who return every 7 days. The duplicate key ignores procedures and amount, so a legitimate second visit the same day can score as a duplicate. *Next:* add a cross-provider same-day check, and add procedure codes to the keys or whitelist known follow-up protocols.
- **Mismatch is off for unknown diagnosis codes.** The map has 15 codes and matching is exact, so on real ICD-10 data the rule would mostly do nothing. The report counts upcoding skips but not these. *Next:* report the number of unmapped claims, normalize codes, and extend the map.
- **Phantom billing uses an absolute limit of 30.** It ignores provider size and flags every claim of the day at High (71). A large hospital would trigger it daily. *Next:* compare with the provider's own daily history.
- **The data is synthetic.** Recall 100% and the FPR of about 3% depend on how the data is built (see section 1). *Next:* add natural noise to the clean claims and re-measure, and test on real labeled claims.

## 9. Time

Source: [docs/TIMELOG.md](docs/TIMELOG.md). The estimate was written before any code.

| Phase | Scope | Estimate | Actual |
| :--- | :--- | ---: | ---: |
| 0 | Repo setup, brief, this estimate | 0.25 h | 0.25 h |
| 1 | Understand the brief, decisions, data design, plan | 0.75 h | 75 h (as logged) |
| 2–3 | Skeleton, types, config, seeded data generator | 1.0 h | not logged |
| 4 | 8 rules, test-first | 1.5 h | not logged |
| 5 | Scoring, metrics, threshold sweep, holdout | 0.75 h | not logged |
| 6–7 | Review, README, AI log index, submission | 0.75 h | not logged |
| | **Total** | **5.0 h** | not logged |

The retrospective in the time log is still empty.

## 10. How I worked with AI

I used Claude chat to study the brief and plan the work, including drafting the prompts. I used Claude Code to write all the code, with one session per phase. I picked the model and effort per task: Opus for planning and review, Sonnet for writing code against a settled plan.

### Session logs

| File | What the phase did |
| :--- | :--- |
| [01-understand-and-plan.txt](ai-conversation/01-understand-and-plan.txt) | Read the brief, summarized the 8 rules, listed ambiguities, wrote DECISIONS.md, DATA_DESIGN.md and CLAUDE.md. |
| [02-03-setup-generator.txt](ai-conversation/02-03-setup-generator.txt) | Project setup (types, config, CSV), settled the open design points (Decisions 12–18), planned and wrote the seeded generator. |
| [04.txt](ai-conversation/04.txt) | Context indexes, the amount_clustering and weekend_anomaly rules, a fix to the weekend denominator, rule index and engine. |
| [05.txt](ai-conversation/05.txt) | Scoring, metrics report, pipeline, seed-7 holdout, an audit of the perfect results, `npm run inspect`. |
| [06.txt](ai-conversation/06.txt) | Reviewer pass: BRIEF requirements table, five biggest risks, four small fixes, fast-forward merge to main. |

### Moments worth reading

- [04.txt](ai-conversation/04.txt): I asked whether the weekend rule divides by the provider's surgical claims or all claims. The AI said all claims, which was wrong; it rewrote the tests first, then fixed the rule (Decision 19).
- [01-understand-and-plan.txt](ai-conversation/01-understand-and-plan.txt): I checked the AI's list of ambiguities against six points of my own. It admitted it had missed label leakage and had only half-covered phantom billing.
- [02-03-setup-generator.txt](ai-conversation/02-03-setup-generator.txt): The AI simulated my clustering and weekend decisions and found two holes (mean + 2 SD of about 48,600 on one combination; only about 13 surgical claims per hospital). I resolved them as Decisions 16 and 17.
- [05.txt](ai-conversation/05.txt): I said perfect results were suspicious. The audit found no label leak but also no natural noise in the clean data, and that `npm run inspect` pointed at a file that did not exist. I decided to keep the data and document the limit (Decision 21).
- [06.txt](ai-conversation/06.txt): One fix I asked for contradicted an existing test. The AI stopped and asked instead of editing the test. I chose to change Decision 4 to match the code; recall and FPR did not change.
