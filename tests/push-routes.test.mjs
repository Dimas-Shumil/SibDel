import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import express, { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireRoles } from '../middleware/roles.js';

test('all campaign/test endpoints are OWNER-only; preferences/devices bind identity from auth and validate inputs', async () => {
  const calls=[];
  const service = new Proxy({}, { get: (_o,name) => async (...args) => { calls.push([name,...args]); return name === 'configuration' ? {enabled:false} : name === 'campaigns' ? {campaigns:[],page:1,totalPages:1} : {}; } });
  const auth=(req,_res,next)=>req.auth ? next() : next(Object.assign(Error('Login'),{statusCode:401}));
  const modules={express:{Router},zod:{z},'../lib/prisma.js':{prisma:{}},'../config/push.js':{pushConfig:{},CONSENT_VERSION:'v1',CONSENT_TEXT:'text'},'../services/push.service.js':{createPushService:()=>service},'../middleware/auth.js':{requireAuth:auth},'../middleware/admin-auth.js':{adminAuth:[auth]},'../middleware/roles.js':{requireRoles},'../middleware/rate-limit.js':{sensitiveRateLimiter:(_q,_s,n)=>n()},'../middleware/validate.js':{validate}};
  const mod=new SourceTextModule(await readFile(new URL('../routes/push.routes.js',import.meta.url),'utf8'));
  await mod.link((name)=>new SyntheticModule(Object.keys(modules[name]),function(){for(const [key,value]of Object.entries(modules[name]))this.setExport(key,value)}));await mod.evaluate();
  const app=express();app.use(express.json(),(req,_res,next)=>{const role=req.get('test-role');if(role){req.user={id:7,role};req.auth={user:req.user,session:{id:9}}}next()});
  app.use('/customer',mod.namespace.customerPushRouter);app.use('/admin',mod.namespace.adminPushRouter);
  app.use((err,_req,res,_next)=>res.status(err.statusCode||500).json({code:err.code||'ERROR',message:err.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,role,method='GET',body)=>fetch(origin+url,{method,headers:{...(role?{'test-role':role}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try{
    for(const [url,method]of [['/admin/campaigns','GET'],['/admin/campaigns','POST'],['/admin/campaigns/1/schedule','POST'],['/admin/campaigns/1/cancel','POST'],['/admin/test','POST'],['/admin/devices','POST']]){
      assert.equal((await request(url,null,method,method==='POST'?{}:undefined)).status,401);
      for(const role of ['STAFF','CUSTOMER'])assert.equal((await request(url,role,method,method==='POST'?{}:undefined)).status,403);
    }
    assert.equal(calls.length,0);
    assert.equal((await request('/admin/campaigns','OWNER')).status,200);
    assert.equal((await request('/customer/preferences','CUSTOMER')).status,200);
    assert.deepEqual(calls.at(-1),['preferences',7]);
    assert.equal((await request('/customer/consent','CUSTOMER','POST',{granted:true,version:'v1',userId:99})).status,400);
    assert.equal((await request('/customer/preferences','CUSTOMER','PUT',{orders:true,subscriptions:true,marketing:true})).status,400);
    assert.equal((await request('/customer/consent','CUSTOMER','POST',{granted:true,version:'v1'})).status,200);
    assert.deepEqual(calls.at(-1),['consent',7,9,true,'v1']);
    assert.equal((await request('/customer/devices/22','CUSTOMER','DELETE')).status,200);
    assert.deepEqual(calls.at(-1),['unsubscribe',7,22]);
    assert.equal((await request('/admin/campaigns','OWNER','POST',{requestKey:'not-uuid'})).status,400);
  }finally{await new Promise(r=>server.close(r))}
});
