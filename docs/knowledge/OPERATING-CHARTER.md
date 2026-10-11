# Operating Charter

## Objective

NASai must make coding work safer and more reproducible by connecting every completion claim to inspectable evidence.

## Status language

- `PASS`: the stated acceptance check ran successfully and produced inspectable evidence.
- `FAIL`: the check ran and did not meet acceptance criteria.
- `NOT VERIFIED`: no suitable check ran in the required environment.

These labels are not interchangeable. A passing source test cannot upgrade an installer check from `NOT VERIFIED` to `PASS`.

## Operating sequence

Discover → Baseline → Scope → Implement → Verify → Review → Commit/PR → Release.

## Product-enforced policies

- Workspace scope enforcement
- Exit-code and result validation
- Project-rules loading
- Quality gates before commit/release
- Credential isolation
- Approval gates for sensitive actions
- Recoverable checkpoints
- Evidence-based task status

Rules may change when stronger evidence appears. Amend the relevant document and record the source rather than silently overriding policy.
