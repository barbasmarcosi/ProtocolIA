# G2 stage 1: retrieve verified canonical v0.3 output and inspect both generators.
FROM python:3.13-slim AS contract
WORKDIR /repo
COPY src/protocolia ./src/protocolia
COPY examples/books-paging-v03/contract.json ./examples/books-paging-v03/contract.json
COPY examples/books-paging-v03/resources.json ./examples/books-paging-v03/resources.json
COPY examples/books-paging-v03/http-errors.json ./examples/books-paging-v03/http-errors.json
RUN PYTHONPATH=src python -m protocolia compile-bundle \
 examples/books-paging-v03/contract.json --profile java-spring-basic-demo \
 --resources examples/books-paging-v03/resources.json \
 --domain-errors examples/books-paging-v03/http-errors.json \
 --out /contract-bundle

FROM node:22-bookworm-slim AS client-probe
WORKDIR /g2
COPY experiments/g2-client-spike/package.json ./
COPY experiments/g2-client-spike/orval.config.ts ./
COPY experiments/g2-client-spike/kubb.config.ts ./
COPY experiments/g2-client-spike/tsconfig.json ./
COPY experiments/g2-client-spike/src ./src
COPY --from=contract /contract-bundle/openapi.json ./openapi.json
RUN echo 'G2_CHECK_KUBB_REGISTRY_VERSIONS' && \
 npm view kubb version && \
 npm view @kubb/plugin-ts version && \
 npm view @kubb/plugin-fetch version && \
 npm view @kubb/plugin-react-query version && \
 npm view @kubb/plugin-react-query versions --json | tail -35
RUN npm install --no-audit --no-fund
RUN npm ls --depth=0
RUN npm run generate:orval
RUN echo 'G2_ORVAL_GENERATED_EXPORTS' && grep -E '^(export (const|function|type|interface) |export \{)' src/generated/orval/books.ts | head -95
RUN npm run generate:kubb
RUN echo 'G2_KUBB_GENERATED_FILES' && find src/generated/kubb -type f | sort | head -65
RUN echo 'G2_GENERATOR_CANDIDATE_PROBE_DONE'
FROM alpine:3.21
COPY --from=client-probe /g2/openapi.json /verified-openapi.json
CMD ["sh","-c","echo 'G2 candidate codegen probe only: no HTTP parity yet'; exit 1"]
