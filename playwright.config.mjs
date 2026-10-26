import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',workers:1,retries:process.env.CI?1:0,
 use:{baseURL:'http://127.0.0.1:4831',trace:'retain-on-failure'},
 projects:[{name:'desktop',use:{viewport:{width:1280,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
 webServer:{command:'node tests/fixtures/order-server.js :memory: 4831',url:'http://127.0.0.1:4831',env:{NODE_ENV:'test',PORT:'4831'},reuseExistingServer:false}
});
