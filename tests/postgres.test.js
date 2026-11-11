import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {createPostgres,postgresOptions} from '../database.js';
process.env.NODE_ENV='test';
const {createApp}=await import('../server.js');
test('remote PostgreSQL requires verified TLS',()=>{
 assert.equal(postgresOptions('postgresql://u:p@example.com/db?sslmode=disable').ssl.rejectUnauthorized,true);
});
test('PostgreSQL serializes checkout and cancellation and preserves receipts and payment keys across restart',{skip:!process.env.POSTGRES_TEST_URL},async()=>{
 let db=await createPostgres(process.env.POSTGRES_TEST_URL), db2=await createPostgres(process.env.POSTGRES_TEST_URL);
 const provider=new Map();
 const paymentOptions={config:{shop:'1',key:'test_fixture',returnUrl:'https://shop.example/'},send:async(url,options)=>{
  let row;
  if(url.endsWith('/cancel')){
   row=[...provider.values()].find(r=>url.includes(r.id));
   assert.match(options.headers['Idempotence-Key'],/^[a-f0-9]{64}$/);
   row.status='canceled';
  } else if(options.body){const b=JSON.parse(options.body),key=options.headers['Idempotence-Key'];row=provider.get(key)||{id:randomUUID(),test:true,paid:false,status:'pending',amount:b.amount,metadata:b.metadata};provider.set(key,row);}
  else {row=[...provider.values()].find(r=>url.includes(r.id));}
  return Response.json(row);
 }};
 const owner='o'.repeat(40),old=process.env.APP_OWNER_TOKEN;process.env.APP_OWNER_TOKEN=owner;
 const payload={customer:'Postgres fixture',email:'fixture@example.test',items:[{productId:1,quantity:1}]}, key=randomUUID();
 try{
  await db.pool.query('UPDATE products SET stock=1 WHERE id=1');
  let app=createApp(db,{paymentOptions}),app2=createApp(db2,{paymentOptions});
  const submit=(a,k)=>request(a).post('/api/orders').set('Idempotency-Key',k).send(payload);
  const duplicate=await Promise.all([submit(app,key),submit(app2,key)]);
  assert.deepEqual(duplicate.map(r=>r.status).sort(),[200,201]);assert.equal(duplicate[0].body.id,duplicate[1].body.id);
  const id=duplicate[0].body.id;
  assert.equal((await submit(app,randomUUID())).status,409);
  assert.equal((await request(app).get('/api/orders/'+id)).status,404);
  assert.equal((await db.pool.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,0);
  const paid=await request(app).post(`/api/orders/${id}/payment`).set('X-Order-Key',key);assert.equal(paid.status,200);
  const paymentKey=(await db.pool.query('SELECT idempotence_key FROM test_payments WHERE resource_id=$1',[String(id)])).rows[0].idempotence_key;
  await db.close();db=await createPostgres(process.env.POSTGRES_TEST_URL);app=createApp(db,{paymentOptions});
  assert.equal((await request(app).get('/api/orders/'+id).set('X-Order-Key',key)).status,200);
  assert.equal((await db.pool.query('SELECT idempotence_key FROM test_payments WHERE resource_id=$1',[String(id)])).rows[0].idempotence_key,paymentKey);
  // Authorization by the provider precedes cancellation of a held payment.
  provider.get(paymentKey).status='waiting_for_capture';
  const cancel=a=>request(a).post(`/api/orders/${id}/payment/cancel`).set('X-Order-Key',key);
  assert.deepEqual((await Promise.all([cancel(app),cancel(app2)])).map(r=>r.status),[200,200]);
  assert.equal((await db.pool.query('SELECT stock FROM products WHERE id=1')).rows[0].stock,1);
  assert.equal((await db.pool.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status,'canceled');
  const stock=await request(app).patch('/api/owner/products/1/stock').auth(owner,{type:'bearer'}).send({stock:5,expectedStock:1});assert.equal(stock.status,200);
  assert.equal((await request(app).patch('/api/owner/products/1/stock').auth(owner,{type:'bearer'}).send({stock:9,expectedStock:1})).status,409);
  assert.equal((await request(app).get('/api/owner/orders').auth(owner,{type:'bearer'})).status,200);
 }finally{await db.close();await db2.close();if(old===undefined)delete process.env.APP_OWNER_TOKEN;else process.env.APP_OWNER_TOKEN=old;}
});
