# P4 empirical execution audit — 2026-10-11 UTC

Status: BLOCKED BEFORE MODEL EXECUTION. No quota-consuming experimental session was launched. P4 remains OPEN. No A/B/C outcome or winner exists.

Both main HEADs were revalidated by Git clone: ProtocolIA e694f700c0ff9e8a8d26165d27232f914d3b9e72, ProtocolIA-Test 87e482961f29eb7c8a6c5c9bc60de2ad08a903cc. The verifier checkout was detached at 77ec9150fed3b1ae4e80c87befc052e34702af8c and git status was clean.

The unchanged preregistration freezes 36 sessions, 2400 seconds per trial, at study digest 680037ab74cd4520243b8a8926402b317ae8cb7e2c2dbb84f5952b00cef14ab8. Three fresh catalog-crud workspaces were actually prepared and task hashes checked. Frozen order is B conventional, C ProtocolIA, A direct, repetition 1. Prepared is not executed.

## Observed blockers

Codex exists at /opt/codex/bin/codex (outside default PATH), version 0.159.2. `login status` reports ChatGPT authentication; this does not establish availability of any particular model or quota. Actual model, effort and tokens remain unknown. No model call was made to probe them.

The real installed parser rejects the runner's old `codex exec --ask-for-approval never` placement with exit 2. Moving the global option before `exec` resolves the parser failure. A regression test invokes the real installed CLI with --help only, so it consumes no model quota. This does not prove end-to-end model execution.

The environment has Java 17 only and no Maven or Docker in PATH. Maven Central was reachable with HTTP 200, so dependency acquisition is not asserted impossible. The decisive unresolved gate is restricted disposable execution and grader isolation: bubblewrap failed opening a namespace; `unshare --user --map-root-user true` failed writing uid_map with Operation not permitted; a harmless `codex sandbox -- /bin/true` probe timed out at 5 seconds. No candidate Java was executed. Directory separation alone is insufficient to claim that agents cannot read the verifier, other arms, private evidence or host credentials.

## Validation

Regression red: installed CLI argument test failed on the original runner with unexpected --ask-for-approval. Green: all 14 local-runner tests passed after the fix, including the installed parser test. Remaining fake CLI tests are infrastructure tests, NOT experimental results.

Full local suite: 141 tests ran, five errors: test_action_schema, test_broker_schema and test_v02 imports need jsonschema; test_live_unix_socket_peer_checks_and_malformed_json and test_only_approved_peer_uid_can_connect_by_config were denied Unix socket creation by this environment. No full-suite green claim; see committed unit-tests.log.

## Reproduction and unblock procedure

Use a separate disposable Linux VM with Java 21, Maven, OpenAPI Generator 7.20.0 and ProtocolIA checked out at the preregistered tool commit 1e4a0370c3902b08b5f3a855d8adc3b0466cab0a. Use the corrected coordinator separately from that treatment compiler. Authenticate Codex normally with ChatGPT, without API keys. Fix one CLI version, supported model and effort for all arms and record resolved settings before evaluated runs.

Keep the host-only verifier and results outside the agent's readable filesystem, not merely outside its writable root. Preinstall treatment tools, disable access to public grader sources and other trial artifacts, and probe denial of grader/credential access plus resource/network restrictions. Give only the selected candidate and its permitted treatment tools to each fresh agent. Serve each candidate in a separate disposable restricted VM/container without authentication credentials, recording candidate tree digest, build/JAR digest, process/container identity and verifier URL. Test actual compilation and HTTP reachability before consuming evaluated quota using a nonexperimental reference service.

On that host follow P4-LOCAL-RUNNER.md to freeze the unchanged study, prepare the exact assignment and explicitly run --execute with the pinned model. Preserve B/C/A order for catalog-crud r01, use the same 2400-second ceiling, and finalize with the clean exact consumer checkout. Do not transplant this host's absolute-path prepared manifests; recreate them and retain this audit separately. Never retry a started assignment silently. The preparation and parser commands were checked here; VM isolation, model execution and candidate serving remain unverified until those host probes pass.

## Decision

Scheduled 36; prepared 3; real sessions 0; independent candidate verdicts 0. Success, elapsed experimental time, tokens, repairs and compilation failures are unknown for all arms. No evidence supports or refutes ProtocolIA effectiveness yet. The next useful work is provisioning the isolation boundary and executing the first frozen B/C/A triple, not extending the benchmark architecture.
