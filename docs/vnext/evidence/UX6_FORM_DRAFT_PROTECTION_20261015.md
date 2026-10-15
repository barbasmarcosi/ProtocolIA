# UX6 — Generated draft-loss protection (2026-10-15)

This increment protects generic generated create forms against accidental closure of unsaved edits. Dirty fields are derived from the canonical IR field manifests (including relational selections). Closing a modified draft by Escape, Cancel, close button, or outside interaction opens an accessible in-dialog confirmation. Continue editing preserves all React form values; discard returns focus to the invoking create action, without posting anything to the API. The existing nested relation-pickers keep their own Escape dismissal behavior. A native beforeunload safeguard covers refresh and navigation.

This behavior is implemented in the shared generated React template, not in any specific domain. No autosave or durable draft storage is claimed.

Integration acceptance must verify Chromium keyboard and focus behavior, negative API persistence, mobile/desktop screenshots, both generated backends against PostgreSQL, and the unchanged independent frozen domain oracle. Evidence pending isolated run.
