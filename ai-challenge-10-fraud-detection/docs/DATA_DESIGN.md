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

## D. Providers

There are 50 providers:

| Group | Count | Operating days | Claim types |
|---|---:|---|---|
| 24/7 hospitals | 15 | every day, including weekend emergency surgery | all |
| Scheduled-surgery hospitals | 15 | Mon–Fri only; no clean weekend claims | all |
| General clinics | 15 | Mon–Fri only | OUTPATIENT |
| Dental clinics | 5 | Mon–Sat | DENTAL |

Each scheduled-surgery hospital that receives weekend injections has ≥ 30 surgical claims (Decision 14).

There are about 500 members, all drawn from one shared pool for clean and fraudulent claims.

## E. Amounts

- **Clean claim amount:** the sum over the claim's codes of (reference price × right-skewed lognormal noise of about 15%), rounded to 10.
- **Clustering band:** a clean amount in 47,500–49,999 is resampled (Decision 12).
- **Fraudulent claims** are rounded the same way, so round amounts do not reveal the label.

Expected clean statistics for the high-cost combinations (simulated with σ = 0.15, after resampling):

| Combination | Mean | SD | Mean + 2 SD |
|---|---:|---:|---:|
| K35.80 [P-1007, B-9002] | ≈ 38,100 | ≈ 5,250 | ≈ 48,600 |
| K35.80 [P-1008, B-9002] | ≈ 45,000 | ≈ 5,900 | ≈ 56,900 |
| K80.20 [B-9003] | ≈ 66,100 | ≈ 9,700 | ≈ 85,500 |
| S52.50 [P-1006, P-2004, P-2002] | ≈ 65,200 | ≈ 8,300 | ≈ 81,800 |

## F. Fraud injection (200 claims)

| Pattern | Count | How it is injected |
|---|---:|---|
| Duplicate | 30 | Exact copy of a clean claim, same date. The label belongs to the copy with the larger `claim_id`, assigned after IDs are given (Decisions 1, 10). |
| Rapid re-submission | 30 | Copy of a non-surgical clean claim dated +1..7 days, keeping member and diagnosis, with a new amount. A weekend date means a new offset is drawn. The original stays clean (Decision 13). |
| Upcoding | 30 | Clean claim amount × random factor 1.35–2.5, never landing in 47,500–49,999. |
| Unbundling | 25 | A claim with a bundle code has it replaced by all of the bundle's components, priced item by item. |
| Phantom billing | 25 | One general clinic on one weekday gets 25 fake claims. At least 6 of that clinic's clean claims are moved to the same day, so the day has ≥ 31 claims. The moved clean claims are known false positives (Decision 5). |
| Weekend anomaly | 20 | Saturday or Sunday surgery at scheduled-surgery hospitals, at most 2 per hospital (Decision 14). |
| Dx–procedure mismatch | 20 | A mapped diagnosis paired with an unrelated procedure, e.g. J06.9 + P-2001. |
| Amount clustering | 20 | Amount drawn from 47,500–49,999, applied only to combinations with clean mean ≥ 35,000 and SD ≥ 5,000. If none qualify, the generator stops with an error (Decision 12). |

**Generator constraints:**
- Clean claims with the same member + provider + procedure codes are ≥ 8 days apart (Decision 13).
- Claims are shuffled and sorted by date before `claim_id` is assigned (Decision 10).

## G. Output files

| File | Contents |
|---|---|
| `data/claims.csv` | The 10 brief columns. `procedure_codes` is joined with `\|`. Quoting follows RFC 4180. No label column. |
| `data/labels.csv` | `claim_id`, `is_fraud`, `fraud_types`. Rules never read this file. |
