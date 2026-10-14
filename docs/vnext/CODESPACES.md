# ProtocolIA A14 — Running acceptance on free GitHub Codespaces

This is a **local cloud development environment**, NOT GitHub Actions and NOT a published application. It uses the free *Codespaces* allowance (separate from Actions) for a personal GitHub account. GitHub can charge for usage beyond the allowance if the account has billing enabled; check budgets and set a spending stop before running. GitHub's own docs: https://docs.github.com/en/billing/concepts/product-billing/github-codespaces

## First use

1. Open the PR branch's official creation link: https://codespaces.new/barbasmarcosi/ProtocolIA/tree/feature/vnext-a0-typespec-jhipster-spike (select the **2-core** machine and the **ProtocolIA vNext A14 acceptance** configuration).
2. After VS Code opens, execute this ONE command in the terminal from the repository root:

```bash
bash scripts/vnext/run-codespaces-a14.sh
```

The runner detects an incorrect branch or unavailable Docker daemon *before* attempting builds. Creation only runs a lightweight Docker readiness check; **heavy compilation is never started automatically or repeated after every resume**. The devcontainer uses the **Docker-in-Docker v4** feature with an independent daemon, rather than depending on a forwarded host socket; no prebuild and no Actions workflow are configured.

## Repairing an existing Codespace after `BLOCKED: Docker daemon not accessible`

The original configuration used `docker-outside-of-docker`, which depends on a functioning host Docker socket. The corrected configuration uses the official `ghcr.io/devcontainers/features/docker-in-docker:4` with its own engine and a small, Ubuntu 24.04 base image.

In the terminal of the **existing** Codespace:

```bash
git pull --ff-only
```

Then in the VS Code browser/editor command palette choose **Codespaces: Rebuild Container**. This is **required**: merely pulling the new devcontainer file does not install the Docker daemon into a container that is already running. Rebuilding preserves files under `/workspaces`. Once it reopens, run:

```bash
bash scripts/vnext/codespaces-doctor.sh
bash scripts/vnext/run-codespaces-a14.sh
```

The doctor prints Docker CLI version, socket presence and the daemon's concrete error. The launcher retries only the daemon check during startup. If it remains blocked, share the doctor output, not a speculative product failure. These commands do **not** use GitHub Actions or Render.

GitHub's instructions on rebuilding: https://docs.github.com/en/codespaces/developing-in-a-codespace/rebuilding-the-container-in-a-codespace

## What the command actually tests

- Compiler/IR generation (real TypeSpec), npm unit and negative tests.
- A13 **unaltered** historical contract compiled to real Spring Boot 4 (Java 21) and NestJS, then the A14.1 and A14.2 contract variants built to both targets with real Maven, Node 24 and Vite.
- A14.1 guarded FK reassignment: PostgreSQL, HTTP audit rollback, CAS concurrency, Chromium 390×844, restart and historical A13-to-A14.1 in-place evolution.
- A14.2 typed search by a one-hop FK, status and UTC interval: PostgreSQL, HTTP, rejected filters, indexes, read roles, Chromium 390×844, restart and A13-to-A14.2 additive evolution with original rows/audit intact.

The Dockerfile orders **A13 generation before the evolution tests**, the same order now enforced in the Render Dockerfile. PostgreSQL is temporary and local to each Docker RUN; no external database is modified. Browser/API listeners use the container's loopback only.

## Trustworthy evidence

- All command output is saved under `.protocolia-evidence/codespaces/<UTC>-<commit>.build.log`.
- A JSON report beside it contains the exact commit, branch, exit code, and `PASS` or `FAIL`.
- The shell preserves the Docker build exit code through `tee`; any test/build failure is **FAIL**. New gates are **NOT RUN** until this command is actually executed in a Codespace.
- **Do not** commit or publicly share complete logs until they have been reviewed for secrets (the scripts generate ephemeral Basic-auth test passwords).
- Please share the result JSON or the relevant failed portion of the log in the conversation; those are empirical data for updating the acceptance matrix and fixing code in the PR.
- Set Codespaces idle timeout to 15–30 minutes and stop/delete the environment after the run to minimize quota/storage. Docker image/caches also consume disk.

## Limits

The default 2-core Codespace has limited compute and disk. A large multi-stage Docker build can require significant storage and elapsed time; if it fails due to disk/memory, record **BLOCKED by resources**, not a product FAIL. We cannot assume the Codespaces account is connected to our current GitHub tool's shell: the GitHub connector can edit and inspect the repository but does **not** currently expose a Codespaces create/SSH/exec operation. Initial creation and terminal invocation therefore require the repository owner's account.

No GitHub Actions workflows, paid CI runners, Render deployments, new managed databases, or prebuilds are requested by this configuration. Codespaces usage is billed/offset against **Codespaces' separate allowance**, so keep the environment stopped when unused.

## First empirical run and next run

On 2026-10-14 the owner ran the suite at commit `a2a123d`: all Spring/Nest/React/TypeSpec A14.2 builds completed successfully; Docker failed before DB probes on Bash syntax in the A14.1 evolution script. Two probe function definitions are now fixed, A14.2 index-only migrations are handled in the schema preservation check, and **all** shell scripts are linted near the start of the Docker build. These changes need a fresh real run; do not count the DB/HTTP/Chromium gates as PASS yet.

The existing Codespace does **not** need rebuilding for these repository-only changes: `git pull --ff-only`, then rerun `bash scripts/vnext/run-codespaces-a14.sh`. Docker's cached build layers should avoid repeating unchanged successful stages when possible.
