import test from "node:test";
import assert from "node:assert/strict";
import { createHealthHandler } from "../middleware/health.js";
function response() { return { headers: {}, setHeader(k,v){this.headers[k]=v;}, status(n){this.code=n;return this;}, json(x){this.body=x;return this;} }; }
test("healthy production response has no fingerprint and no cache", async()=>{
 const r=response(); await createHealthHandler({probe:async()=>1, fingerprint:()=>{throw Error("must not run");}})({},r);
 assert.equal(r.code,200); assert.equal(r.headers["Cache-Control"],"no-store"); assert.equal("testEnvironment" in r.body,false);
});
test("database failure is 503 without error details", async()=>{
 const r=response(); await createHealthHandler({probe:async()=>{throw Error("password-secret");}})({},r);
 assert.equal(r.code,503); assert.equal(JSON.stringify(r.body).includes("secret"),false);
});
test("hung probe is bounded, coalesced and recovers", async()=>{
 let resolve; let calls=0; const h=createHealthHandler({probe:()=>{calls++;return new Promise(r=>{resolve=r;});},timeoutMs:15});
 const a=response(),b=response(); await Promise.all([h({},a),h({},b)]);
 assert.equal(a.code,503); assert.equal(b.code,503); assert.equal(calls,1);
 resolve(); await new Promise(r=>setImmediate(r)); const c=response(); const result=h({},c); await new Promise(r=>setImmediate(r)); resolve(); await result;
 assert.equal(c.code,200); assert.equal(calls,2);
});
test("test fingerprint remains available only in test mode",async()=>{
 const r=response(); await createHealthHandler({probe:async()=>1,isTest:true,fingerprint:()=>"test-only"})({},r);
 assert.equal(r.body.testEnvironment.databaseFingerprint,"test-only");
});
