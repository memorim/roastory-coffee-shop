import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV='test';
const {createDb,createApp}=await import('../server.js');
test('malformed JSON returns a bounded JSON error without server internals',async()=>{
 const db=createDb(':memory:');try{
  const result=await request(createApp(db)).post('/api/invalid').set('Content-Type','application/json').send('{broken');
  assert.equal(result.status,400);assert.match(result.headers['content-type'],/json/);assert.deepEqual(result.body,{message:'Не удалось обработать запрос'});
 }finally{db.close();}
});
