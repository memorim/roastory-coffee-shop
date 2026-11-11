import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV='test';
const {createApp,createDb}=await import('../server.js');

test('provider cancellation discovered by refresh releases the reservation exactly once',async()=>{
 const db=createDb(':memory:');let status='pending',forged=false,cancelCalls=0,reference;
 const send=async(url,options)=>{
  if(options.body)reference=JSON.parse(options.body).metadata?.reference || reference;
  if(url.endsWith('/cancel'))cancelCalls++;
  return new Response(JSON.stringify({id:'provider-id',test:true,paid:status==='succeeded',status,amount:{value:forged?'0.01':'1090.00',currency:'RUB'},metadata:{reference}}));
 };
 try {
  const app=createApp(db,{paymentOptions:{config:{shop:'1',key:'test_fixture',returnUrl:'https://shop.example/'},send}});
  const created=await request(app).post('/api/orders').send({customer:'Cancel check',email:'check@example.test',items:[{productId:1,quantity:1}]});
  const path='/api/orders/'+created.body.id+'/payment',key=created.body.accessKey;
  const post=suffix=>request(app).post(path+suffix).set('X-Order-Key',key).send({});
  assert.equal((await post('')).status,200);
  assert.equal((await post('/cancel')).status,409);
  assert.equal(cancelCalls,0);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock,99);
  status='canceled';forged=true;
  assert.equal((await post('/refresh')).status,503);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock,99);
  forged=false;
  assert.equal((await post('/refresh')).status,200);
  await Promise.all([post('/refresh'),post('/cancel')]);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=1').get().stock,100);
  assert.equal(db.prepare('SELECT status FROM orders').get().status,'canceled');
  assert.equal((await post('')).status,409);
 } finally {db.close();}
});
