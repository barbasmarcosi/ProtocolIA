# S2c — replay state preflight before new event claims (2026-11-02)

## Problem and invariant

The single-host event replay writer previously checked only whether **requested**
event marker names already existed. A historical marker with malformed JSON,
unsafe permissions, a replaced inode, or an unexpected file in the private
directory could be ignored when a new, disjoint signed event was claimed.
That could create a misleading clean replay outcome while local evidence
was already corrupted. The separate read-only inspector detected the
problem, but the writer did not require that inspection.

**Invariant:** before claiming any new provider event, the *entire* existing
local replay directory must pass the established descriptor-bound forensic
format inspection, not merely the requested event IDs. A crash lock must
not be silently ignored or removed.

## Implementation

- Reuse `inspectLocalEventReplay` before opening a new provider lock.
  Refuse malformed historical markers, unexpected entries and any
  preexisting crash lock without creating new replay state.
- Reinspect after creating/fsyncing our provider-scoped O_EXCL lock,
  requiring exactly one well-formed lock (ours) and canonical existing
  markers. This reduces the initial inspection-to-lock TOCTOU window.
- Do not pin the *number* of markers across the two scans: a prior
  contender can finish in between. The existing duplicate-event
  preflight must still safely release our lock when it finds the
  newly consumed event. A post-lock inspection failure retains the
  lock for manual review, never silently deleting possible evidence.
- Keep exact signed statement, financial comparison, directory permissions,
  O_EXCL, fsync and duplicate-event semantics unchanged.

## Acceptance

The dedicated S2c Node 22/24 workflow runs the complete existing
signed-statement, local replay, event replay, operator attestation and
registry tests, including 10 simultaneous processes, crash locks and
read-only forensic scans. Added regression cases assert:

1. A previously claimed marker with corrupted contents blocks a fresh
   disjoint signed event; no new lock or event is written.
2. An unexpected file and a valid crash lock from another provider
   block new claims without mutation.
3. An intact historical marker permits a disjoint valid signed event.

CI links and reviewed SHA belong in the PR after workflows finish;
this document alone is not evidence that CI passed.

## Explicit limits

This is **single-host local format integrity only**. The directory may have
been rolled back or emptied before either scan; neither scan is a complete
atomic filesystem snapshot. An adversary with the directory owner's
permissions may still tamper with state between scans. There is no
distributed event uniqueness, external provider identity verification,
bank settlement proof, audited multitenant journal, production IAM or
real-money processing. TL-14 (#57) remains OPEN.
