import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { seoMiddleware } from '../middleware/seo.js';
import { jsonLd, structuredPage } from '../utils/seo-structured-data.js';

const publicPath = fileURLToPath(new URL('../public/', import.meta.url));
const origin = 'https://sib-del.ru';
const fixture = {
  id: 3, slug:'taiga-test', name:'Деликатес </script><script>alert(1)</script>', sku:'S-3',
  description:'Натуральное описание', shortDescription:'Описание товара', price:'250.00',
  isAvailable:true, stockState:'available', category:{name:'Колбасы',slug:'kolbasy'},
  images:[{url:'/uploads/products/photo.webp',alt:'Фото'}], primaryImage:{url:'/uploads/products/photo.webp'},
  rating:{average:4.5,count:8}, reviews:[], relatedProducts:[],
};
const mockCatalog = { products:[fixture],pagination:{total:1,totalPages:1} };
function queryOf(url){ return Object.fromEntries(new URL(url,'http://localhost').searchParams.entries()); }
async function request(url, overrides={}) {
  const req = {method:'GET',path:new URL(url,'http://localhost').pathname,originalUrl:url,query:queryOf(url),log:{error(){}}};
  const headers = new Map();
  const res = {
    statusCode:200, contentType:'', text:'',
    setHeader(k,v){headers.set(k.toLowerCase(),v);return this;},
    getHeader(k){return headers.get(k.toLowerCase());},
    status(n){this.statusCode=n;return this;},
    type(t){this.contentType=t;return this;},
    send(t){this.text=t;return this;},
    redirect(n,to){this.statusCode=n;this.setHeader('Location',to);return this;},
  };
  const middleware=seoMiddleware({
    publicPath, siteUrl:origin,
    getProduct:async slug=>slug===fixture.slug?fixture:null,
    getCatalog:async()=>mockCatalog,
    parseCatalog:query=>({...query, page:Number(query.page)||1}),
    countProducts:async()=>1,
    listProducts:async()=>[{slug:fixture.slug}],
    listCategories:async()=>[{slug:'kolbasy',name:'Колбасы'}],
    getCategory:async slug=>slug==='kolbasy'?{slug,name:'Колбасы',description:'Вся категория Колбасы'}:null,
    ...overrides,
  });
  let nextCalled=false;
  await middleware(req,res,()=>{nextCalled=true;});
  return {res,headers,nextCalled};
}
function graphs(html){
  const match=html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  return match?JSON.parse(match[1])['@graph']:[];
}

test('JSON-LD never allows CMS content to break out of script',()=>{
  const output=jsonLd([{'@type':'Product',name:'</script><script>alert(1)</script>'}]);
  assert.doesNotMatch(output,/<script>alert\(1\)/);
  assert.doesNotMatch(output,/<\/script><script/);
  assert.equal(graphs(output)[0].name,'</script><script>alert(1)</script>');
});

test('Homepage declares only confirmed OnlineStore and WebSite facts',async()=>{
  const {res}=await request('/');assert.equal(res.statusCode,200);
  const graph=graphs(res.text);
  assert.equal(graph.find(x=>x['@type']==='OnlineStore').url,origin+'/');
  assert.equal(graph.find(x=>x['@type']==='WebSite').inLanguage,'ru-RU');
  assert.doesNotMatch(res.text,/"streetAddress"|"telephone"|"taxID"/);
  assert.match(res.text,/<link rel="canonical" href="https:\/\/sib-del.ru\/"/);
});

test('Product markup uses actual inventory, RUB price and approved rating',async()=>{
  const {res}=await request('/product.html?slug=taiga-test&utm_source=foo');
  assert.equal(res.statusCode,200);
  const graph=graphs(res.text);const p=graph.find(x=>x['@type']==='Product');
  assert.equal(p.offers.price,'250.00');assert.equal(p.offers.priceCurrency,'RUB');
  assert.equal(p.offers.availability,'https://schema.org/InStock');
  assert.equal(p.aggregateRating.ratingCount,8);
  assert.equal(p.image[0],origin+'/uploads/products/photo.webp');
  assert.equal(graph.find(x=>x['@type']==='BreadcrumbList').itemListElement.length,3);
  assert.doesNotMatch(res.text,/utm_source=foo|<script>alert/);
});

test('Unavailable product reports OutOfStock and no unverified rating',async()=>{
  const {res}=await request('/product.html?slug=taiga-test', {getProduct:async()=>({...fixture,isAvailable:false,stockState:'out',rating:{average:null,count:0},primaryImage:null,images:[]})});
  const p=graphs(res.text).find(x=>x['@type']==='Product');
  assert.equal(p.offers.availability,'https://schema.org/OutOfStock');
  assert.equal(p.aggregateRating,undefined);assert.equal(p.image,undefined);
});

test('Active category has unique title, visible heading, canonical and sitemap',async()=>{
  const {res}=await request('/catalog.html?category=kolbasy&utm_source=a');
  assert.equal(res.statusCode,200);
  assert.match(res.text,/<h1 class="catalog-intro__title" id="catalog-title">Колбасы<\/h1>/);
  assert.match(res.text,/<link rel="canonical" href="https:\/\/sib-del.ru\/catalog.html\?category=kolbasy"/);
  assert.match(res.text,/Вся категория Колбасы/);
  assert.equal(graphs(res.text).find(x=>x['@type']==='CollectionPage').url,origin+'/catalog.html?category=kolbasy');
  const sitemap=await request('/sitemap-categories.xml');
  assert.match(sitemap.res.text,/<loc>https:\/\/sib-del.ru\/catalog.html\?category=kolbasy<\/loc>/);
  const index=await request('/sitemap.xml');assert.match(index.res.text,/sitemap-categories.xml/);
});

test('Faceted filters remain noindex; missing category is not an indexable 200',async()=>{
  const filtered=await request('/catalog.html?category=kolbasy&sort=price-asc');
  assert.equal(filtered.headers.get('x-robots-tag'),'noindex, follow');
  assert.doesNotMatch(filtered.res.text,/rel="canonical"/);assert.equal(graphs(filtered.res.text).length,0);
  const missing=await request('/catalog.html?category=missing');assert.equal(missing.res.statusCode,404);
  assert.match(missing.headers.get('x-robots-tag'),/noindex/);
});

test('FAQ is public crawlable page with unique text and internal links',async()=>{
  const {res}=await request('/faq.html');assert.equal(res.statusCode,200);
  assert.match(res.text,/<h1>Вопросы и ответы<\/h1>/);
  assert.match(res.text,/Сколько стоит доставка\?/);
  assert.match(res.text,/<link rel="canonical" href="https:\/\/sib-del.ru\/faq.html"/);
  const footer=await readFile(new URL('../components/footer.html',import.meta.url),'utf8');
  assert.match(footer,/href="\/faq.html"/);
  const sitemap=await request('/sitemap-pages.xml');assert.match(sitemap.res.text,/\/faq.html/);
});

test('Local development does not invent a public domain',async()=>{
  const {res}=await request('/',{siteUrl:''});assert.doesNotMatch(res.text,/application\/ld\+json|rel="canonical"/);
});

test('Structured page API omits broken images and reviews',()=>{
  const html=structuredPage({origin,path:'/product.html?slug=one',title:'Один товар',description:'Подробно',product:{name:'Один товар',price:0,isAvailable:true,primaryImage:{url:'javascript:alert(1)'},rating:{average:5,count:0}}});
  const p=graphs(html).find(x=>x['@type']==='Product');
  assert.equal(p.image,undefined);assert.equal(p.offers,undefined);assert.equal(p.aggregateRating,undefined);
});
