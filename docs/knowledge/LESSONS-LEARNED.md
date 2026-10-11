# Lessons Learned

## Stable lessons

1. Green CI is partial evidence, not proof of the installed user experience.
2. Approve information architecture and the primary workflow before heavy implementation.
3. Diagnose from repository state, logs, exit codes, and runtime evidence before editing.
4. Small stages with clean history reduce rework.
5. Installation and update behavior are product capabilities, not packaging details.
6. Keep optional external services out of the critical path when local-first operation is sufficient.
7. Separate source, dependency, runtime, packaging, and environment failures.

## Known costly patterns

- Declaring a feature complete from automated tests alone.
- Redesigning after building dense forms and navigation.
- Adding databases, services, or orchestration before the core workflow is stable.
- Repeating the same diagnosis without a changed input or saved result.
- Trusting an agent's `PASS` without identifiers, artifacts, or observable effects.

This summary comes from the supplied “NAS Engineering Knowledge Base”, version 1.0. Its historical review was explicitly incomplete; claims without original evidence remain guidance, not audited facts.
