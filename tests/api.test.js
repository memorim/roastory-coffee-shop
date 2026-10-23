import{describe,it}from'node:test';import assert from'node:assert/strict';import request from'supertest';process.env.NODE_ENV='test';const{createApp,createDb}=await import('../server.js');const app=createApp(createDb(':memory:'));describe('Roastory API',()=>{it('returns coffee catalog',async()=>{const r=await request(app).get('/api/products');assert.equal(r.status,200);assert.equal(r.body.length,6)});it('filters processing method',async()=>{const r=await request(app).get('/api/products?process=Мытая');assert.equal(r.body.length,2)});it('creates order and calculates total',async()=>{const r=await request(app).post('/api/orders').send({customer:'Роман',email:'roman@example.ru',items:[{productId:1,quantity:2}]});assert.equal(r.status,201);assert.equal(r.body.total,2180)});});

describe('Input validation and missing records', () => {
  it('rejects invalid input', async () => { assert.equal((await request(app).post('/api/orders').send({customer:'Demo',email:'demo@example.com',items:[]})).status, 400); });
  it('returns 404 for a missing record', async () => { assert.equal((await request(app).get('/api/products/999')).status, 404); });
});
