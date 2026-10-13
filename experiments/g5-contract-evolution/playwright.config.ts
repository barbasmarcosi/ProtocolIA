import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',
 timeout:45000,expect:{timeout:10000},retries:0,workers:1,
 reporter:[['list']],
 use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:4173',trace:'retain-on-failure'},
 // Keep original G3 assumptions of a fresh database: run the existing
 // baseline first, then exercise v0.4 mutation/omission against that state.
 projects:[
  {name:'g3-baseline',testMatch:'browser.spec.ts'},
  {name:'g5-evolution',testMatch:'browser-evolution.spec.ts',dependencies:['g3-baseline']},
 ],
});
