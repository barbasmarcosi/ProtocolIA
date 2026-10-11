# P4 Render smoke — no experimental results

This isolated branch ONLY probes Java 21/Maven/Spring Boot 4 compilation and serving over HTTP on Render Free, without accessing models or hidden verifier. It is not Codex-generated. NEVER count this endpoint or JAR as a P4 B/C/A outcome and never share this scaffold with experimental agents.

Configure a FREE Docker web service with Dockerfile `deployment/p4-render-probe/Dockerfile`, context `.`, autoDeploy `no`, no environment secrets. This remains isolated from all GastroApp services. The only endpoint is `/health` and intentionally returns `agent_generated:false,verified_trial:false`.

When there is actual independently generated B/C/A source, deploy the respective immutable code commit to this or a separate temporary service (same Docker runtime/tool versions); capture commit, JAR SHA256, deploy ID, no-credential process, runtime and build logs, failure details. Do not alter the frozen experiment's tasks, prompts, model or evaluator.

The ProtocolIA-Test verifier pinned at `77ec9150fed3b1ae4e80c87befc052e34702af8c` only supports localhost. An operator-owned loopback proxy to the ephemeral public HTTPS candidate is necessary; do not modify the verifier. Warm up Render to avoid exceeding its 5-second per HTTP-request timeout. A public Render free web service is not a private sandbox; keep credentials out and remove trial exposure promptly. Free services share workspace monthly instance-hours. No API keys, new billing or provider usage.
