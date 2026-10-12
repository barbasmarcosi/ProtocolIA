import { defineConfig } from 'kubb/config';
import { pluginTs } from '@kubb/plugin-ts';
import { pluginFetch } from '@kubb/plugin-fetch';
import { pluginReactQuery } from '@kubb/plugin-react-query';

// Deliberately bounded competing candidate; generated outside the chosen output.
export default defineConfig({
  input: './openapi.json',
  output: { path: './src/generated/kubb', clean: true },
  plugins: [
    pluginTs({ output: { path: './types' } }),
    pluginFetch({ output: { path: './client' } }),
    pluginReactQuery({ output: { path: './hooks' }, client: 'fetch' }),
  ],
});
