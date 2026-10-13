import { defineConfig } from 'orval';

// Real target-scoped HTTP projection generated from ProtocolIA v0.3 IR.
// This contract MUST be copied by the build; not maintained by hand.
export default defineConfig({
  tools: {
    input: { target: './openapi.json' },
    output: {
      mode: 'single',
      target: 'src/generated/orval/tools.ts',
      schemas: 'src/generated/orval/models',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        // The user-owned fetch mutator returns JSON body on 2xx and throws
        // ApiHttpError on non-2xx. Keep generated types faithful to that.
        fetch: {
          includeHttpResponseReturnType: false,
          forceSuccessResponse: true,
          includeHttpErrorResponse: false,
        },
        mutator: { path: './src/api/http.ts', name: 'httpClient' },
      },
    },
  },
});
