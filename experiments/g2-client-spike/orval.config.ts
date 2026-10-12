import { defineConfig } from 'orval';

// Real target-scoped HTTP projection generated from ProtocolIA v0.3 IR.
// This contract MUST be copied by the build; not maintained by hand.
export default defineConfig({
  books: {
    input: { target: './openapi.json' },
    output: {
      mode: 'single',
      target: 'src/generated/orval/books.ts',
      schemas: 'src/generated/orval/models',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        mutator: { path: './src/api/http.ts', name: 'httpClient' },
      },
    },
  },
});
