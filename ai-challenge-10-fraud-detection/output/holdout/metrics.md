# Metrics report

<!-- seed-comparison:start -->
## seed 42 vs seed 7

Each run is a separate dataset scored with the same code and config, with no tuning in between. Flagged = score > 0. Difference = seed 7 − seed 42.

| Metric | seed 42 | seed 7 | Difference |
| :--- | ---: | ---: | ---: |
| Precision | 79.4% | 80.3% | +1.0 pp |
| Recall | 100.0% | 100.0% | +0.0 pp |
| FPR | 2.9% | 2.7% | −0.2 pp |
| F1 | 88.5% | 89.1% | +0.6 pp |
| Precision@100 | 79.0% | 80.0% | +1.0 pp |
| Flagged claims | 252 | 249 |  |

No metric differs by more than 5 pp.
<!-- seed-comparison:end -->

Computed from `output/holdout/scored.json` and `data/holdout/labels.csv`: 2,000 claims, 200 labeled fraud and 1,800 clean.

## Headline: flagged = score > 0 (Decision 9)

|  | Labeled fraud | Labeled clean | Total |
| :--- | ---: | ---: | ---: |
| **Flagged** | TP 200 | FP 49 | 249 |
| **Not flagged** | FN 0 | TN 1,751 | 1,751 |
| **Total** | 200 | 1,800 | 2,000 |

| Metric | Value | Formula | Target |
| :--- | ---: | :--- | :--- |
| Precision | 80.3% | TP / (TP + FP) |  |
| Recall | 100.0% | TP / (TP + FN) | ≥ 70.0%: met |
| FPR | 2.7% | FP / (FP + TN), i.e. over clean claims only | ≤ 20.0%: met |
| F1 | 89.1% | 2TP / (2TP + FP + FN) |  |

## Threshold sweep: flagged = score ≥ t

| t | Flagged | TP | FP | FN | TN | Precision | Recall | FPR | F1 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 249 | 200 | 49 | 0 | 1,751 | 80.3% | 100.0% | 2.7% | 89.1% |
| 10 | 249 | 200 | 49 | 0 | 1,751 | 80.3% | 100.0% | 2.7% | 89.1% |
| 20 | 249 | 200 | 49 | 0 | 1,751 | 80.3% | 100.0% | 2.7% | 89.1% |
| 30 | 249 | 200 | 49 | 0 | 1,751 | 80.3% | 100.0% | 2.7% | 89.1% |
| 40 | 180 | 131 | 49 | 69 | 1,751 | 72.8% | 65.5% | 2.7% | 68.9% |
| 50 | 180 | 131 | 49 | 69 | 1,751 | 72.8% | 65.5% | 2.7% | 68.9% |
| 60 | 160 | 111 | 49 | 89 | 1,751 | 69.4% | 55.5% | 2.7% | 61.7% |
| 70 | 63 | 56 | 7 | 144 | 1,793 | 88.9% | 28.0% | 0.4% | 42.6% |
| 80 | 0 | 0 | 0 | 200 | 1,800 | n/a | 0.0% | 0.0% | 0.0% |
| 90 | 0 | 0 | 0 | 200 | 1,800 | n/a | 0.0% | 0.0% | 0.0% |

## Precision@K

Top K flagged claims in rank order (score descending, then claim_id ascending). If fewer than K claims are flagged, all flagged claims are used. Claims tied with the score at the cut-off may fall on either side of it.

| K | Claims considered | Fraud | Precision@K | Score at cut-off |
| :--- | ---: | ---: | ---: | ---: |
| 50 | 50 | 44 | 88.0% | 71 |
| 100 | 100 | 80 | 80.0% | 63 |
| 200 | 200 | 151 | 75.5% | 39 |

## Per rule

"Fraud" counts fired claims labeled with any fraud type. "Own-pattern recall" is the share of claims labeled with the rule’s own pattern on which that rule fired.

| Rule | Fires | Fraud | Rule precision | Own pattern caught | Own-pattern recall |
| :--- | ---: | ---: | ---: | ---: | ---: |
| duplicate_claim | 30 | 30 | 100.0% | 30 / 30 | 100.0% |
| rapid_resubmission | 30 | 30 | 100.0% | 30 / 30 | 100.0% |
| upcoding | 73 | 31 | 42.5% | 30 / 30 | 100.0% |
| unbundling | 25 | 25 | 100.0% | 25 / 25 | 100.0% |
| phantom_billing | 32 | 25 | 78.1% | 25 / 25 | 100.0% |
| weekend_anomaly | 20 | 20 | 100.0% | 20 / 20 | 100.0% |
| dx_procedure_mismatch | 20 | 20 | 100.0% | 20 / 20 | 100.0% |
| amount_clustering | 20 | 20 | 100.0% | 20 / 20 | 100.0% |

## Engine recall by fraud pattern

A labeled claim counts as caught when its score is > 0, whichever rule fired.

| Pattern | Labeled | Caught | Recall |
| :--- | ---: | ---: | ---: |
| duplicate_claim | 30 | 30 | 100.0% |
| rapid_resubmission | 30 | 30 | 100.0% |
| upcoding | 30 | 30 | 100.0% |
| unbundling | 25 | 25 | 100.0% |
| phantom_billing | 25 | 25 | 100.0% |
| weekend_anomaly | 20 | 20 | 100.0% |
| dx_procedure_mismatch | 20 | 20 | 100.0% |
| amount_clustering | 20 | 20 | 100.0% |

## Upcoding coverage

- Not evaluated because the procedure-code group has fewer than 10 other claims (Decision 15): **25** claims.
- Not evaluated because the other claims in the group all have the same amount (SD = 0): 0 claims.

## Performance

- Rules, scoring and ranking for 2,000 claims: **29.9 ms**.
- Including reading config and claims and writing `scored.json` and `ranked.csv`: 37.6 ms.
- Brief limit: 30 s for 2,000 claims.
