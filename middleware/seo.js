import { structuredPage } from "../utils/seo-structured-data.js";
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PUBLIC_PAGES = ['/', '/catalog.html', '/about.html', '/business.html', '/contacts.html', '/production.html', '/promotions.html', '/subscription.html', '/how-to-order.html', '/delivery.html', '/delivery-terms.html', '/reviews.html', '/faq.html'];
const PRIVATE = /^\/(?:api|admin|account|components)(?:\/|$)|^\/(?:login|register|forgot-password|reset-password|cart|checkout|favorites|privacy-policy|offer|personal-data-consent)(?:\.html)?\/?$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function siteOrigin(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || /^(localhost|127\.|\[::1\])/.test(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}
const money = value => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value))} ₽`;
// Only public image paths or HTTPS URLs; never emit filesystem paths or arbitrary schemes.
export function imageUrl(value) {
  const s = String(value || '');
  if (/^\/(?:site\/images|uploads\/products)\/[A-Za-z0-9_./% -]+$/.test(s) && !s.includes('..')) return s;
  try { const u = new URL(s); if (u.protocol === 'https:' && !u.username && !u.password) return u.href; } catch {}
  return '/site/images/product-placeholder.svg';
}
function substitute(template, values) {
  return template.replace(/@@([A-Za-z]+)@@/g, (_, key) => values[key] ?? '');
}
function productLink(p) { return `/product.html?slug=${encodeURIComponent(p.slug)}`; }
function cards(products, prefix = 'catalog-product-card') {
  return products.map(p => `<article class="${prefix}"><a class="${prefix}__media" href="${escapeHtml(productLink(p))}"><img class="${prefix}__image" src="${escapeHtml(imageUrl(p.primaryImage?.url))}" alt="${escapeHtml(p.primaryImage?.alt || p.name)}" width="600" height="600" loading="lazy" decoding="async"></a><div class="${prefix}__body"><a class="${prefix}__title" href="${escapeHtml(productLink(p))}">${escapeHtml(p.name)}</a><span class="${prefix}__measure">${escapeHtml(p.unitLabel || p.unit)}</span><strong class="${prefix}__price">${escapeHtml(money(p.price))}</strong></div></article>`).join('');
}
export function renderProduct(template, p) {
  const images = p.images?.length ? p.images : p.primaryImage ? [p.primaryImage] : [];
  const first = images[0];
  const values = Object.fromEntries(Object.entries({
    stockState:p.stockState === 'out' ? 'unavailable' : p.stockState || (p.isAvailable ? 'available' : 'unavailable'), minQuantity:p.minQuantity || 1, step:p.step || 1,
    id:p.id, slug:p.slug, name:p.name, category:p.category?.name, categoryUrl:`/catalog.html?category=${encodeURIComponent(p.category?.slug || '')}`,
    sku:p.sku || 'Уточняется', shortDescription:p.shortDescription || '', price:money(p.price), unitLabel:p.unitLabel || p.unit,
    stock:p.isAvailable ? 'В наличии' : 'Нет в наличии', stockNote:'Окончательная доступность проверяется при оформлении.',
    ratingStars: p.rating?.count ? '★'.repeat(Math.max(0,Math.min(5,Math.round(p.rating.average || 0)))) : '', rating:p.rating?.average ?? '—', reviewCount:p.rating?.count ? `${p.rating.count} отзывов` : 'Нет отзывов', reviewCountShort:p.rating?.count || 0,
    image:imageUrl(first?.url), imageAlt:first?.alt || p.name, imageCount:images.length || 1,
  }).map(([k,v]) => [k,escapeHtml(v)]));
  values.description = String(p.description || p.shortDescription || 'Описание уточняется.').split(/\n\s*\n/).map(x => `<p>${escapeHtml(x)}</p>`).join('');
  values.highlights = (p.highlights || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
  values.characteristics = (p.characteristics || []).filter(x=>x?.name && x?.value).map(x=>`<div class="product-specs__row"><dt>${escapeHtml(x.name)}</dt><dd>${escapeHtml(x.value)}</dd></div>`).join('');
  values.nutrition = (p.nutrition || []).filter(x=>x?.label && x?.value).map(x=>`<p>${escapeHtml(x.label)}: ${escapeHtml(x.value)}</p>`).join('');
  values.thumbs = images.map((x,i)=>`<button class="product-gallery__thumb" type="button" aria-label="Показать фото ${i+1}" aria-pressed="${i===0}" data-gallery-thumb data-gallery-src="${escapeHtml(imageUrl(x.url))}" data-gallery-alt="${escapeHtml(x.alt || p.name)}"><img src="${escapeHtml(imageUrl(x.url))}" alt="" width="120" height="120" loading="lazy"></button>`).join('');
  values.reviews = (p.reviews || []).map(r=>`<article class="product-review-card"><strong>${escapeHtml(r.authorName)}</strong><span aria-label="${escapeHtml(r.rating)} из 5"> ${escapeHtml(r.rating)}/5</span><p>${escapeHtml(r.text)}</p></article>`).join('') || '<p>У этого товара пока нет опубликованных отзывов.</p>';
  values.related = cards(p.relatedProducts || [], 'related-product-card');
  return substitute(template, values);
}
function metadata(html, {title,description,url,structuredData='',type='website'}) {
  html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\b(?=[^>]*name=["']description["'])[^>]*>/ig, '')
    .replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/ig, '')
    .replace(/<meta\b(?=[^>]*property=["']og:[^"']*["'])[^>]*>/ig, '');
  const tags = `<meta name="description" content="${escapeHtml(description)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="${escapeHtml(type)}"><meta property="og:locale" content="ru_RU"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">` + (url ? `<link rel="canonical" href="${escapeHtml(url)}"><meta property="og:url" content="${escapeHtml(url)}">` : '');
  return html.replace('</head>', `${tags}${structuredData}</head>`);
}
function errorPage(res, status, text) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(status).type('html').send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>${text}</title><main><h1>${text}</h1><a href="/catalog.html">Вернуться в каталог</a></main></html>`);
}

// Dependencies are injected so HTTP behavior can be tested without PostgreSQL or SMTP.
export function seoMiddleware({ publicPath, siteUrl, getProduct, getCatalog, parseCatalog, listProducts, countProducts, listCategories, getCategory }) {
  const origin = siteOrigin(siteUrl);
  return async (req,res,next) => {
    let pathname;
    try { pathname = decodeURIComponent(req.path); } catch { return errorPage(res,400,'Некорректный адрес'); }
    if (PRIVATE.test(pathname)) res.setHeader('X-Robots-Tag','noindex, nofollow');
    if (!['GET','HEAD'].includes(req.method)) return next();
    try {
      if (pathname === '/robots.txt') return res.type('text/plain').send(`User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
      if (pathname === '/sitemap.xml' || /^\/sitemap-products-\d+\.xml$/.test(pathname)) {
        if (!origin) return errorPage(res,503,'Публичный адрес ещё не настроен');
        const count = await countProducts();
        const chunks = Math.ceil(count/1000);
        let body;
        if (pathname === '/sitemap.xml') {
          // Static URLs live in their own sitemap so product batches remain bounded.
          body = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${escapeHtml(origin)}/sitemap-pages.xml</loc></sitemap>${listCategories ? `<sitemap><loc>${escapeHtml(origin)}/sitemap-categories.xml</loc></sitemap>` : ''}${Array.from({length:chunks},(_,i)=>`<sitemap><loc>${escapeHtml(origin)}/sitemap-products-${i+1}.xml</loc></sitemap>`).join('')}</sitemapindex>`;
        } else {
          const batch = Number(pathname.match(/-(\d+)\.xml$/)[1]);
          if (!Number.isSafeInteger(batch) || batch<1 || batch>chunks) return errorPage(res,404,'Карта не найдена');
          const products = await listProducts((batch-1)*1000,1000);
          body = urlset(products.map(p=>origin+productLink(p)));
        }
        return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
      }
      if (pathname === '/sitemap-categories.xml' && listCategories) {
        if (!origin) return errorPage(res,503,'Публичный адрес ещё не настроен');
        const categories = await listCategories();
        const urls = categories.filter(c => SLUG.test(c.slug)).map(c => `${origin}/catalog.html?category=${encodeURIComponent(c.slug)}`);
        return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>${urlset(urls)}`);
      }
      if (pathname === '/sitemap-pages.xml') {
        if (!origin) return errorPage(res,503,'Публичный адрес ещё не настроен');
        return res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>${urlset(PUBLIC_PAGES.map(p=>origin+p))}`);
      }
      // Resolve extension aliases before static middleware; never trust Host for SEO URLs.
      const alias = pathname.replace(/\/$/,'') + '.html';
      if (pathname === '/index.html' || pathname === '/index') return res.redirect(301,'/');
      if (!pathname.endsWith('.html') && (PUBLIC_PAGES.includes(alias) || alias==='/product.html')) return res.redirect(301,alias+(req.originalUrl.includes('?') ? '?'+req.originalUrl.split('?')[1] : ''));
      let file = pathname === '/' ? '/index.html' : pathname;
      if (!/^\/[a-z-]+\.html$/.test(file)) return next();
      let template;
      try { template = await readFile(path.join(publicPath,file.slice(1)),'utf8'); } catch(e) { if(e.code==='ENOENT') return next(); throw e; }
      res.setHeader('Cache-Control','no-store');
      let title = template.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || 'Сибирские Деликатесы';
      let description = template.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)/i)?.[1] || 'Сибирские Деликатесы — каталог продуктов, доставка и самовывоз.';
      let canonical = pathname;
      let productData = null;
      let categoryData = null;
      if (file === '/product.html') {
        const slug = req.query.slug;
        if (typeof slug !== 'string' || slug.length>191 || !SLUG.test(slug)) return errorPage(res,404,'Товар не найден');
        const product = await getProduct(slug);
        if (!product) return errorPage(res,404,'Товар не найден');
        productData = product;
        template = renderProduct(template,product);
        title = product.seo?.title || `${product.name} — Сибирские Деликатесы`;
        description = product.seo?.description || product.shortDescription || `Описание и актуальная цена: ${product.name}.`;
        canonical = productLink(product);
      } else if(file === '/catalog.html') {
        const query = parseCatalog(req.query);
        if (!query) return errorPage(res,400,'Некорректные параметры каталога');
        const data = await getCatalog(query);
        if (query.page>1 && query.page>data.pagination.totalPages) return errorPage(res,404,'Страница каталога не найдена');
        template = substitute(template, {catalogCount:escapeHtml(`Найдено товаров: ${data.pagination.total}`), catalogProducts:cards(data.products) || '<p class="catalog-products__message">По выбранным условиям товары не найдены.</p>', pagination:[query.page-1,query.page,query.page+1].filter(n=>n>0 && n<=data.pagination.totalPages).map(n=> {
          const params = new URLSearchParams(Object.entries(req.query).filter(([,v])=>typeof v==='string')); params.set('page',String(n));
          return `<a class="catalog-pagination__link" href="/catalog.html?${escapeHtml(params.toString())}"${n===query.page?' aria-current="page"':''}>${n}</a>`;
        }).join('')});
        const keys = Object.keys(req.query).filter(k => !['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].includes(k));
        const categoryOnly = !!query.category && query.category !== 'all' && keys.every(k=>['category','page'].includes(k));
        if (categoryOnly && getCategory && SLUG.test(query.category)) {
          categoryData = await getCategory(query.category);
          if (!categoryData) return errorPage(res,404,'Категория не найдена');
          canonical = `/catalog.html?category=${encodeURIComponent(query.category)}`+(query.page>1?`&page=${query.page}`:'');
          title = `${categoryData.name} — каталог продуктов | Сибирские Деликатесы`;
          description = categoryData.description?.trim() || `${categoryData.name}: актуальные товары и цены в каталоге Сибирских Деликатесов.`;
          // A category landing page must describe the same category in visible HTML.
          template = template.replace(/(<h1 class="catalog-intro__title" id="catalog-title">)[\s\S]*?(<\/h1>)/, (_, start, end) => `${start}${escapeHtml(categoryData.name)}${end}`);
          template = template.replace(/(<p class="catalog-intro__description">)[\s\S]*?(<\/p>)/, (_, start, end) => `${start}${escapeHtml(description)}${end}`);
        } else if (keys.some(k=>k!=='page')) {
          res.setHeader('X-Robots-Tag','noindex, follow'); canonical=null;
        } else canonical = '/catalog.html'+(query.page>1?`?page=${query.page}`:'');
        if(query.page>1) title = `${title.replace(/ — страница \d+/, '')} — страница ${query.page}`;

      }
      const [header,footer] = await Promise.all(['header.html','footer.html'].map(name => readFile(path.join(publicPath,'..','components',name),'utf8')));
      template = template.replace(/<div data-component="header"><\/div>/,()=>`<div data-component="header">${header}</div>`).replace(/<div data-component="footer"><\/div>/,()=>`<div data-component="footer">${footer}</div>`);
      const publicUrl = origin && canonical && !PRIVATE.test(pathname) ? origin + canonical : null;
      template = metadata(template, {
        title, description, url: publicUrl,
        type: productData ? 'product' : 'website',
        structuredData: publicUrl ? structuredPage({origin, path:canonical, title, description, product:productData, category:categoryData}) : '',
      });
      return res.type('html').send(template);
    } catch(error) {
      // Do not issue an indexable 200 with demonstration content on database errors.
      req.log?.error({err:error},'Public SEO rendering failed');
      return errorPage(res,503,'Временно недоступно. Попробуйте позже.');
    }
  };
}
function urlset(urls) { return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${escapeHtml(u)}</loc></url>`).join('')}</urlset>`; }
