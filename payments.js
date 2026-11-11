import {randomUUID,createHash} from 'node:crypto';
export function paymentConfig(env=process.env) {
 if(!env.YOOKASSA_SHOP_ID&&!env.YOOKASSA_SECRET_KEY)return null;
 if(!/^\d+$/.test(env.YOOKASSA_SHOP_ID||'')||!env.YOOKASSA_SECRET_KEY?.startsWith('test_'))throw new Error('Only YooKassa test-shop credentials are permitted');
 const url=new URL(env.PAYMENT_RETURN_URL);
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Configure an HTTPS payment return URL');
 return {shop:env.YOOKASSA_SHOP_ID,key:env.YOOKASSA_SECRET_KEY,returnUrl:url.href};
}
export function initializePayments(db) {db.exec(`CREATE TABLE IF NOT EXISTS test_payments(resource_id TEXT PRIMARY KEY,idempotence_key TEXT NOT NULL UNIQUE,amount_cents INTEGER NOT NULL,provider_id TEXT,status TEXT NOT NULL DEFAULT 'pending',confirmation_url TEXT,created_at INTEGER NOT NULL);`);}
export function testPaymentService(db,{config=paymentConfig(),send=fetch}={}) {
 async function call(path,body,key,methodOverride) {
  if(!config)throw new Error('Test payments are not configured');
  const response=await send('https://api.yookassa.ru/v3/payments'+path,{method:methodOverride || (body?'POST':'GET'),headers:{Authorization:'Basic '+Buffer.from(config.shop+':'+config.key).toString('base64'),'Content-Type':'application/json',...(key?{'Idempotence-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Payment provider request failed');
  const data=await response.json();
  if(data.test!==true||!/^\w[\w-]{1,80}$/.test(data.id)||!['pending','waiting_for_capture','succeeded','canceled'].includes(data.status))throw new Error('Invalid test payment response');
  return data;
 }
 function verify(data,row) {
  if(row.provider_id && data.id!==row.provider_id)throw new Error('Payment identifier does not match');
  const amount=(row.amount_cents/100).toFixed(2);
  if(data.amount?.value!==amount||data.amount?.currency!=='RUB'||data.metadata?.reference!==row.idempotence_key)throw new Error('Payment details do not match');
  if(data.confirmation?.confirmation_url) {const u=new URL(data.confirmation.confirmation_url);if(u.protocol!=='https:'||!['yoomoney.ru','yookassa.ru'].includes(u.hostname)||u.username||u.password)throw new Error('Invalid confirmation URL');}
 }
 return {
  enabled:!!config,
  async create(resourceId,amountCents,description) {
   if(!config)throw new Error('Test payments are not configured');
   if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>100000000000)throw new Error('Invalid payment amount');
   await db.prepare('INSERT OR IGNORE INTO test_payments(resource_id,idempotence_key,amount_cents,created_at) VALUES(?,?,?,?)').run(String(resourceId),randomUUID(),amountCents,Date.now());
   const row=await db.prepare('SELECT * FROM test_payments WHERE resource_id=?').get(String(resourceId));
   if(row.amount_cents!==amountCents)throw new Error('Payment amount changed; reconcile the existing payment');
   if(row.provider_id)return row;
   if(Date.now()-row.created_at>23*3600000)throw new Error('Payment reconciliation is required before another attempt');
   const data=await call('',{amount:{value:(amountCents/100).toFixed(2),currency:'RUB'},capture:true,confirmation:{type:'redirect',return_url:config.returnUrl},description:description.slice(0,128),metadata:{reference:row.idempotence_key}},row.idempotence_key);
   verify(data,row);
   await db.prepare('UPDATE test_payments SET provider_id=?,status=?,confirmation_url=? WHERE resource_id=?').run(data.id,data.status,data.confirmation?.confirmation_url||null,String(resourceId));
   return await db.prepare('SELECT * FROM test_payments WHERE resource_id=?').get(String(resourceId));
  },
  async refresh(resourceId) {
   const row=await db.prepare('SELECT * FROM test_payments WHERE resource_id=?').get(String(resourceId));
   if(!row?.provider_id)return null;
   const data=await call('/'+encodeURIComponent(row.provider_id));verify(data,row);
   if(data.status==='succeeded'&&data.paid!==true)throw new Error('Payment is not paid');
   await db.prepare('UPDATE test_payments SET status=? WHERE resource_id=?').run(data.status,String(resourceId));
   return {...row,status:data.status};
  },
  async cancel(resourceId) {
   const row=await db.prepare('SELECT * FROM test_payments WHERE resource_id=?').get(String(resourceId));
   if(!row?.provider_id)return null;
   if(row.status==='canceled')return row;
   // Online redirect payments can only be canceled while awaiting capture.
   // Refresh first: a pending or already completed payment must not be sent
   // to the provider's cancellation endpoint.
   const current=await this.refresh(resourceId);
   if(current.status!=='waiting_for_capture')return current;
   const cancelKey=createHash('sha256').update(row.idempotence_key+':cancel').digest('hex');
   const data=await call('/'+encodeURIComponent(row.provider_id)+'/cancel',{},cancelKey,'POST');
   verify(data,row);
   if(data.status!=='canceled')throw new Error('Payment was not canceled');
   await db.prepare('UPDATE test_payments SET status=? WHERE resource_id=?').run(data.status,String(resourceId));
   return {...row,status:data.status};
  }
 };
}

