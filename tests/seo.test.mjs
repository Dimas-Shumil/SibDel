import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicCatalogQuery } from '../utils/catalog-query.js';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { seoMiddleware, siteOrigin, imageUrl } from '../middleware/seo.js';
const root = fileURLToPath(new URL('../public',import.meta.url));
const product = {id:7,slug:'real-product',name:'Настоящий товар <script>alert(1)</script>',shortDescription:'Состав & описание',price:'123.45',minQuantity:'0.3',step:'0.2',unitLabel:'кг',stockState:'out',isAvailable:false,category:{name:'Категория',slug:'category'},seo:{title:'Название </title><script>bad()</script>'},images:[],reviews:[],relatedProducts:[]};
async function withServer(overrides,run) {
 const app=express();
 app.use(seoMiddleware({publicPath:root,siteUrl:'https://shop.example',getProduct:async slug=>slug===product.slug?product:null,getCatalog:async()=>({products:[product],pagination:{totalPages:2}}),parseCatalog:parsePublicCatalogQuery,countProducts:async()=>1001,listProducts:async(skip,take)=>{assert.equal(skip,1000);assert.equal(take,1000);return [{slug:'real-product'}];},...overrides}));
 app.use((_req,res)=>res.send('fallback'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try {await run((url,options)=>fetch(`http://127.0.0.1:${server.address().port}${url}`,options));}
 finally {await new Promise(resolve=>server.close(resolve));}
}
test('configured origin rejects credentials, paths, query, localhost and non-HTTPS',()=>{
 for(const value of ['','http://shop.example','https://name:pass@shop.example','https://shop.example/sub','https://shop.example/?secret=x','https://localhost']) assert.equal(siteOrigin(value),null);
 assert.equal(siteOrigin('https://shop.example/'),'https://shop.example');
 assert.match(imageUrl('javascript:alert(1)'),/placeholder/);assert.match(imageUrl('/uploads/products/../../secret'),/placeholder/);
});
test('product HTTP HTML reflects real data, escapes CMS values, never serves demo',async()=>withServer({},async get=>{
 const r=await get('/product.html?slug=real-product&utm_source=x',{headers:{Host:'attacker.example'}});const s=await r.text();assert.equal(r.status,200);
 assert.match(s,/123,45 ₽/);assert.match(s,/Настоящий товар &lt;script&gt;/);assert.doesNotMatch(s,/<script>bad|<script>alert|Таёжная|@@[a-z]+@@|preview-taezhnaya/);
 assert.match(s,/canonical" href="https:\/\/shop.example\/product.html\?slug=real-product/);
 assert.doesNotMatch(s,/attacker\.example|utm_source=x/);assert.match(s,/Нет в наличии/);assert.match(s,/product-placeholder/);
}));
test('missing/malformed/duplicate product slug gives genuine 404',async()=>withServer({},async get=>{
 for(const url of ['/product.html','/product.html?slug=missing','/product.html?slug=%3Cscript%3E','/product.html?slug=a&slug=b']) {const r=await get(url);assert.equal(r.status,404);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.doesNotMatch(await r.text(),/Таёжная/);}
}));
test('database failure gives 503, noindex and no demonstration fallback',async()=>withServer({getProduct:async()=>{throw Error('secret');}},async get=>{
 const r=await get('/product.html?slug=real-product');assert.equal(r.status,503);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.doesNotMatch(await r.text(),/secret|Таёжная/);
}));
test('catalog page canonical preserves pagination; filters stay noindex and keep working',async()=>withServer({},async get=>{
 let r=await get('/catalog.html?page=2');assert.equal(r.status,200);assert.match(await r.text(),/canonical" href="https:\/\/shop.example\/catalog.html\?page=2/);
 r=await get('/catalog.html?discount=1');assert.equal(r.status,200);assert.equal(r.headers.get('x-robots-tag'),'noindex, follow');assert.doesNotMatch(await r.text(),/rel="canonical"/);
 assert.equal((await get('/catalog.html?page=3')).status,404);assert.equal((await get('/catalog.html?page=bad')).status,400);
}));
test('service routes get noindex including aliases, nested account shell and API case',async()=>withServer({},async get=>{
 for(const url of ['/api/catalog','/API/health','/admin/login','/account/index.html','/checkout.html','/login','/privacy-policy.html','/personal-data-consent.html','/offer.html'])assert.match((await get(url)).headers.get('x-robots-tag'),/noindex/);
}));
test('robots permits crawling so noindex is readable and sitemap contains only public canonical URLs',async()=>withServer({},async get=>{
 let s=await (await get('/robots.txt')).text();assert.match(s,/Sitemap: https:\/\/shop.example\/sitemap.xml/);assert.doesNotMatch(s,/Disallow: \/site/);
 s=await(await get('/sitemap.xml')).text();assert.match(s,/sitemap-products-2.xml/);assert.doesNotMatch(s,/sitemap-products-3.xml/);
 s=await(await get('/sitemap-products-2.xml')).text();assert.match(s,/product.html\?slug=real-product/);
 assert.equal((await get('/sitemap-products-3.xml')).status,404);
 s=await(await get('/sitemap-pages.xml')).text();assert.doesNotMatch(s,/account|checkout|offer|privacy-policy|personal-data-consent|admin|api\//);assert.match(s,/catalog.html/);
}));
test('unset/invalid public domain affects SEO endpoints only, never canonicalizes to Host',async()=>{
 for(const siteUrl of ['', 'https://user:secret@host.example'])await withServer({siteUrl},async get=>{
 const r=await get('/about.html');assert.equal(r.status,200);const s=await r.text();assert.doesNotMatch(s,/rel="canonical"|secret/);
 assert.equal((await get('/sitemap.xml')).status,503);assert.doesNotMatch(await(await get('/robots.txt')).text(),/Sitemap:/);
 });
});
test('extension aliases permanently redirect without losing product identity',async()=>withServer({},async get=>{
 const r=await get('/product?slug=real-product',{redirect:'manual'});assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/product.html?slug=real-product');
 const home=await get('/index.html',{redirect:'manual'});assert.equal(home.status,301);assert.equal(home.headers.get('location'),'/');
}));

test('HTTP catalog defaults match browser; explicit availability and invalid bounds validated',()=>{
 const q=parsePublicCatalogQuery({utm_source:'campaign'});assert.equal(q.available,true);assert.equal(q.limit,12);assert.equal(q.page,1);
 assert.equal(parsePublicCatalogQuery({available:'0'}).available,false);assert.equal(parsePublicCatalogQuery({outOfStock:'1'}).available,false);
 for(const query of [{page:'0'},{page:'100001'},{priceFrom:'5',priceTo:'1'},{sort:'invalid'},{q:['a','b']}])assert.equal(parsePublicCatalogQuery(query),null);
});

test('all public pages serve nonempty HTML with one canonical and meaningful metadata',async()=>withServer({},async get=>{
 const pages=['/','/catalog.html','/about.html','/business.html','/contacts.html','/production.html','/promotions.html','/subscription.html','/how-to-order.html','/delivery.html','/delivery-terms.html','/reviews.html'];
 for(const url of pages){
  const r=await get(url);assert.equal(r.status,200,url);const s=await r.text();
  assert.equal((s.match(/<h1\b/g)||[]).length,1,url);assert.equal((s.match(/rel="canonical"/g)||[]).length,1,url);
  assert.match(s,/<meta name="description" content="[^"<>]+"/);assert.match(s,/<header\b/);assert.match(s,/<footer\b/);
  assert.doesNotMatch(s,/<title>Document|@@[A-Za-z]+@@|postgres(?:ql)?:\/\/|checkoutOwnerHash|SESSION_SECRET|SMTP_PASS/);
 }
}));


test('percent-encoded static paths cannot bypass server rendering or noindex',async()=>withServer({},async get=>{
 const r=await get('/%70roduct.html?slug=real-product');assert.equal(r.status,200);const s=await r.text();assert.match(s,/Настоящий товар/);assert.doesNotMatch(s,/@@[a-z]+@@/);
 assert.match((await get('/%61ccount/index.html')).headers.get('x-robots-tag'),/noindex/);
}));
