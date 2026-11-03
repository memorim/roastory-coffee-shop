import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {initializePayments,testPaymentService,paymentConfig} from '../payments.js';
test('test payments use durable idempotency and verify amount currency reference and paid status',async()=>{
 assert.throws(()=>paymentConfig({YOOKASSA_SHOP_ID:'1',YOOKASSA_SECRET_KEY:'live_secret',PAYMENT_RETURN_URL:'https://shop.example/'}));
 const db=new DatabaseSync(':memory:');initializePayments(db);let calls=0,body;const config={shop:'1',key:'test_secret',returnUrl:'https://shop.example/'};
 const send=async(_url,options)=>{calls++;if(options.body)body=JSON.parse(options.body);return new Response(JSON.stringify({id:'provider-id',test:true,paid:!options.body,status:options.body?'pending':'succeeded',amount:body.amount,metadata:body.metadata,confirmation:{confirmation_url:'https://yoomoney.ru/checkout/test'}}));};
 try {const service=testPaymentService(db,{config,send});const first=await service.create(1,12345,'Test');const second=await service.create(1,12345,'Test');assert.equal(first.provider_id,second.provider_id);assert.equal(calls,1);assert.equal(body.amount.value,'123.45');assert.equal((await service.refresh(1)).status,'succeeded');await assert.rejects(()=>service.create(1,12346,'Changed'));
 const forged=testPaymentService(db,{config,send:async()=>new Response(JSON.stringify({id:'provider-id',test:true,paid:true,status:'succeeded',amount:{value:'0.01',currency:'RUB'},metadata:body.metadata}))});await assert.rejects(()=>forged.refresh(1));
 const wrongId=testPaymentService(db,{config,send:async()=>new Response(JSON.stringify({id:'different-provider-id',test:true,paid:true,status:'succeeded',amount:body.amount,metadata:body.metadata}))});await assert.rejects(()=>wrongId.refresh(1),/identifier/);
 }finally{db.close();}
});
