# Data Design

Design of the synthetic dataset. Amounts are in an assumed currency (THB). All prices are fictional. Numbered decisions refer to [DECISIONS.md](DECISIONS.md).

Machine-readable sources: [`config/procedures.json`](../config/procedures.json), [`config/bundles.json`](../config/bundles.json), [`config/dx-procedure-map.json`](../config/dx-procedure-map.json), [`config/thresholds.json`](../config/thresholds.json).

## A. Procedures

| Code | Name | Category | Reference price |
|---|---|---|---:|
| P-1001 | Consultation | medical | 800 |
| P-1002 | Complete blood count | medical | 400 |
| P-1003 | Blood glucose | medical | 200 |
| P-1004 | Liver function test | medical | 600 |
| P-1005 | Urinalysis | medical | 300 |
| P-1006 | X-ray | medical | 1,200 |
| P-1007 | Abdominal ultrasound | medical | 2,000 |
| P-1008 | Abdominal CT | medical | 9,000 |
| P-1009 | Electrocardiogram | medical | 700 |
| P-1010 | HbA1c | medical | 600 |
| P-1011 | Physiotherapy | medical | 900 |
| P-2001 | Appendectomy | surgical | 30,000 |
| P-2002 | Anesthesia | surgical | 8,000 |
| P-2003 | Laparoscopic cholecystectomy | surgical | 60,000 |
| P-2004 | Forearm fracture fixation | surgical | 55,000 |
| P-2005 | Wound suturing | medical (Decision 14) | 3,000 |
| P-3001 | Dental filling | dental | 1,500 |
| P-3002 | Dental X-ray | dental | 500 |
| P-3003 | Root canal treatment | dental | 6,000 |
| P-3004 | Tooth extraction | dental | 1,200 |

A claim is **surgical** if at least one of its codes is `surgical`, including the components of any bundle on the claim (Decision 14).

## B. Bundles

Each bundle costs less than the sum of its components.

| Code | Name | Components | Price |
|---|---|---|---:|
| B-9001 | Basic blood panel | P-1002, P-1003, P-1004 | 1,000 |
| B-9002 | Appendectomy package | P-2001, P-2002 | 36,000 |
| B-9003 | Cholecystectomy package | P-2003, P-2002, P-1007 | 65,000 |
| B-9004 | Root canal package | P-3003, P-3002, P-3001 | 7,000 |
| B-9005 | General health check | P-1001, P-1002, P-1005, P-1006 | 2,200 |

## C. Diagnoses and protocols

Clean claims use only these fixed protocols, so each procedure-code combination repeats often enough for statistics. The valid procedures for a diagnosis are the union of its protocols plus the components of any bundle in them (Decision 7).

| Diagnosis | Claim type | Protocols |
|---|---|---|
| J06.9 | OUTPATIENT | [P-1001] · [P-1001, P-1002] |
| J18.9 | OUTPATIENT | [P-1001, P-1006] · [P-1001, P-1002, P-1006] |
| A09 | OUTPATIENT | [P-1001] · [P-1001, P-1002] |
| N39.0 | OUTPATIENT | [P-1001, P-1005] |
| E11.9 | OUTPATIENT | [P-1001, P-1010] · [P-1001, B-9001] |
| I10 | OUTPATIENT | [P-1001] · [P-1001, P-1009] |
| M54.5 | OUTPATIENT | [P-1001, P-1011] · [P-1001, P-1006] |
| Z00.0 | OUTPATIENT | [B-9005] |
| S61.0 | OUTPATIENT | [P-1001, P-2005] |
| K35.80 | INPATIENT | [P-1007, B-9002] · [P-1008, B-9002] |
| K80.20 | INPATIENT | [B-9003] |
| S52.50 | INPATIENT | [P-1006, P-2004, P-2002] |
| K02.9 | DENTAL | [P-3001] · [P-3002, P-3001] |
| K04.0 | DENTAL | [B-9004] |
| K08.1 | DENTAL | [P-3002, P-3004] |

No clean protocol contains every component of a bundle without the bundle code itself, so clean claims never fire unbundling.

## D. Providers and claim mix

There are 50 providers:

| Group | Count | Operating days | Claim types |
|---|---:|---|---|
| 24/7 hospitals | 15 | every day, including weekend emergency surgery | all |
| Scheduled-surgery hospitals | 15 (12 heavy + 3 light) | Mon–Fri only; no clean weekend claims | all |
| General clinics | 15 | Mon–Fri only | OUTPATIENT |
| Dental clinics | 5 | Mon–Sat | DENTAL |

There are 1,800 clean claims (Decision 17):

| Segment | Share | Claims | Split |
|---|---:|---:|---|
| Surgical (inpatient) | 25% | 450 | K35.80 180 (90 per protocol), K80.20 135, S52.50 135 |
| Dental | 15% | 270 | 90 per diagnosis, dental clinics only |
| Outpatient | 60% | 1,080 | 120 per diagnosis; about half at general clinics, the rest at hospitals |

Surgical claims are allocated to providers deterministically:

| Providers | Surgical claims each | Total |
|---|---:|---:|
| 12 heavy scheduled-surgery hospitals | 30 | 360 |
| 3 light scheduled-surgery hospitals | 10 | 30 |
| 15 24/7 hospitals | 4 | 60 |

- Every hospital outside the 12 heavy ones has fewer than 20 surgical claims (Decision 17).
- Dates are drawn uniformly from the provider's operating days in 2024.
- Members are drawn uniformly from one shared pool of 500 (M-0001 to M-0500), for both clean and fraudulent claims.
- Clean claims with the same member + diagnosis are ≥ 8 days apart (Decision 18).

## E. Amounts

- **Amount of a claim:** the sum over its codes of (reference price × exp(0.15 · Z)), with Z standard normal, rounded to 10.
- **Clustering band:** an amount in 47,500–49,999 is resampled (Decision 12).
- **Same sampler for every "normal" amount:** clean claims and every fraudulent claim whose amount is not part of the pattern use this sampler, so neither rounding nor the amount distribution reveals the label.

Expected clean statistics for the high-cost combinations (simulated, after resampling):

| Combination | Mean | SD | Mean + 2 SD | Clustering base (Decision 16) |
|---|---:|---:|---:|---|
| K35.80 [P-1007, B-9002] | ≈ 38,100 | ≈ 5,250 | ≈ 48,600 | no |
| K35.80 [P-1008, B-9002] | ≈ 45,000 | ≈ 5,900 | ≈ 56,900 | yes |
| K80.20 [B-9003] | ≈ 66,100 | ≈ 9,700 | ≈ 85,500 | yes |
| S52.50 [P-1006, P-2004, P-2002] | ≈ 65,200 | ≈ 8,300 | ≈ 81,800 | yes |

The generator measures these values on the data it produces and fails if no combination qualifies.

## F. Fraud injection (200 claims)

The 1,800 clean claims are generated first. Then 200 fraudulent claims are added as **new rows**, in the order below.

| # | Pattern | Count | How it is injected |
|---|---|---:|---|
| 1 | Phantom billing | 25 | One general clinic on one weekday D gets 25 fake outpatient claims, each from a different member. 6 of that clinic's clean claims are moved to D. The moved claims and any clean claims already on D are known false positives (Decision 5). |
| 2 | Weekend anomaly | 20 | A surgical protocol on a Saturday or Sunday at the 12 heavy hospitals: 8 hospitals × 2 claims + 4 hospitals × 1 claim (Decision 14). |
| 3 | Duplicate | 30 | Exact copy of a clean claim (same date and amount). The label goes to the copy with the larger `claim_id`, assigned after IDs (Decisions 1, 10). |
| 4 | Rapid re-submission | 30 | Copy of a non-surgical clean claim dated +k days, k in 1..7, with a new amount. k must give a weekday that stays in 2024. The next claim with the same member + diagnosis must be ≥ 8 days after the copy (Decision 13). |
| 5 | Unbundling | 25 | A protocol that contains a bundle code, with the bundle code replaced by all of its components, priced item by item. Spread across the 6 protocols that contain a bundle. |
| 6 | Dx–procedure mismatch | 20 | A mapped diagnosis paired with the full protocol of a diagnosis from another group (outpatient, surgical, dental), with ≥ 1 code not valid for it. |
| 7 | Upcoding | 30 | Amount = clean mean + z × clean SD of the combination, z in [3, 4.5]. One claim per combination with ≥ 20 clean claims, and a second only in combinations with ≥ 85 clean claims, because a second upcoded claim inflates the first one's leave-one-out SD. |
| 8 | Amount clustering | 20 | Amount drawn uniformly from 47,500–49,999 (rounded to 10), only on clustering-base combinations (Decision 16). |

**Constraints on every injection:**
- Dates are in 2024 and on the provider's operating days. The only exception is the weekend pattern.
- Except for duplicate and rapid copies, every injected claim is ≥ 8 days from every other claim with the same member + diagnosis. As a result, injections do not create unintended rapid or duplicate matches.
- A clean claim is the base of at most one injection. Fraudulent claims, phantom-moved claims and claims on the phantom provider-day are never bases.

**Checks on the final dataset** (the generator fails if any check fails):
- Every clustering claim has a leave-one-out z ≤ 2.
- Every upcoded claim has a leave-one-out z ≥ 2.5.
- Every combination with ≥ 11 claims has SD > 0.
- Every hospital outside the 12 heavy ones has a weekend share ≥ 8% or fewer than 20 surgical claims.

Finally, claims are shuffled with the seed, stably sorted by date, and only then given IDs `CLM-00001`… (Decision 10).

## G. Output files

`npm run generate -- --seed 42 --out data/` writes:

| File | Contents |
|---|---|
| `claims.csv` | Exactly the 10 brief columns, in brief order. `procedure_codes` is joined with `\|`. Quoting follows RFC 4180. No label column. |
| `labels.csv` | `claim_id,fraud_type` for all 2,000 claims. `fraud_type` is a rule name, or `clean`. Rules never read this file. |
