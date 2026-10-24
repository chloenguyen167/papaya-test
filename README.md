# Papaya Insurtech: Full-Stack Engineer test

**Nguyễn Phi Yến**, Full-Stack Engineer, Papaya Insurtech

## Submission

1. [Logical questions](logical-questions/ANSWERS.md)
2. [AI Challenge 10: Fraud Detection Scoring Engine](ai-challenge-10-fraud-detection/README.md)

## Why Challenge 10

It has results I can measure with numbers (recall, FPR, precision), and it uses the skills I work with every day (TypeScript, data modeling, testing) on insurance claims.

## Results (seed 42, synthetic data)

| Recall | FPR | Precision |
| ---: | ---: | ---: |
| 100.0% | 2.9% | 79.4% |

The data is synthetic and every fraud pattern is injected past its rule's threshold, so 100% recall is expected. FPR and precision are the numbers to trust, and FPR is probably optimistic. The challenge README explains why. Source: [metrics.md](ai-challenge-10-fraud-detection/output/metrics.md).

## Run it

```bash
cd ai-challenge-10-fraud-detection
npm ci
npm run all   # generate, score, report
npm test
```
