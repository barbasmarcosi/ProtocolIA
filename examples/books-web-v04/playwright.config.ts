import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'browser.spec.ts',
 timeout:45000,expect:{timeout:10000},retries:0,workers:1,
 reporter:[['list']],
 use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
});
