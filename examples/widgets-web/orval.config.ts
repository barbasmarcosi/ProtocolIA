import { defineConfig } from 'orval';

// Independent resource using the exact pinned Orval adapter and user-owned mutator.
export default defineConfig({
  widgets: {
    input: { target: './openapi.json' },
    output: {
      mode: 'single',
      target: 'src/generated/orval/widgets.ts',
      schemas: 'src/generated/orval/models',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        fetch: { includeHttpResponseReturnType: false,
          forceSuccessResponse: true, includeHttpErrorResponse: false },
        mutator: { path: './src/api/http.ts', name: 'httpClient' },
      },
    },
  },
});
