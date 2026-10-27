// Usage after production deployment: node scripts/seo-live-check.mjs https://sib-del.ru
// Network requests are limited to the specified hostname. No credentials are used.
const base = new URL(process.argv[2] || 'https://sib-del.ru');
if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
  console.error('Укажите HTTPS-домен без пути, query и логина.');process.exit(2);
}
let errors=0;
async function check(path, validate) {
  try {
    const url=new URL(path,base);
    if(url.origin!==base.origin) throw new Error('Внешний URL запрещён');
    const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    const body=await r.text();
    validate(r,body);
    console.log(`PASS ${r.status}: ${path}`);
    return body;
  } catch(err) { console.error(`FAIL: ${path} — ${err.message}`);errors++;return ''; }
}
const expect=(value,msg)=>{if(!value)throw Error(msg)};
await check('/',(r,s)=>{
  expect(r.status===200,'HTTP статус не 200');
  expect(s.includes(`<link rel="canonical" href="${base.origin}/"`),'Неверный canonical');
  expect(s.includes('"@type":"OnlineStore"'),'Нет Organization');
});
await check('/robots.txt',(r,s)=>{
  expect(r.status===200,'HTTP статус не 200');expect(s.includes(`Sitemap: ${base.origin}/sitemap.xml`),'Нет sitemap');
});
await check('/sitemap.xml',(r,s)=>{
  expect(r.status===200,'HTTP статус не 200');expect(s.includes('/sitemap-pages.xml'),'Нет страниц');expect(s.includes('/sitemap-categories.xml'),'Нет категорий');
});
await check('/sitemap-pages.xml',(r,s)=>{expect(r.status===200,'HTTP статус не 200');expect(s.includes('/faq.html'),'Нет FAQ');});
await check('/sitemap-categories.xml',(r,s)=>{expect(r.status===200,'HTTP статус не 200');});
await check('/faq.html',(r,s)=>{expect(r.status===200,'HTTP статус не 200');expect(s.includes('Вопросы и ответы'),'Нет текста FAQ');});
await check('/account',(r)=>{expect(/noindex/.test(r.headers.get('x-robots-tag')||''),'Личный кабинет не помечен noindex');});
await check('/product.html?slug=nonexistent-seo-check-421',(r)=>{expect(r.status===404,'Несуществующий товар должен возвращать 404');});
console.log(errors?`Найдены проблемы: ${errors}`:'Базовая проверка SEO пройдена. Индексацию и Lighthouse проверять отдельно.');
if(errors) process.exitCode=1;
