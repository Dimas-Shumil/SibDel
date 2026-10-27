// Search structured data is derived only from publicly visible, verified fields.
// Never fill organization contacts, addresses, reviews or shipping guarantees with guesses.
export function jsonLd(nodes) {
  if (!nodes?.length) return '';
  const source = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes });
  // Avoid terminating an HTML script element with user-controlled CMS strings.
  return `<script type="application/ld+json">${source.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script>`;
}

function absoluteImage(origin, source) {
  if (typeof source !== 'string' || !source) return undefined;
  if (/^\/(?:site\/images|uploads\/products)\/[a-z0-9_./% -]+$/i.test(source) && !source.includes('..')) return `${origin}${source}`;
  try {
    const url = new URL(source);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {}
  return undefined;
}

function breadcrumbs(origin, current, label, section) {
  const parts = [{ name: 'Главная', url: origin + '/' }];
  if (section) parts.push({ name: section.name, url: origin + section.path });
  parts.push({ name: label, url: origin + current });
  return { '@type': 'BreadcrumbList', itemListElement: parts.map((entry, index) => ({ '@type': 'ListItem', position: index + 1, name: entry.name, item: entry.url })) };
}

export function structuredPage({ origin, path, title, description, product, category }) {
  if (!origin) return '';
  const url = origin + path;
  const storeRef = origin + '/#store';
  const nodes = [];
  if (path === '/') {
    nodes.push({ '@type': 'OnlineStore', '@id': storeRef, name: 'Сибирские Деликатесы', url: origin + '/' });
    nodes.push({ '@type': 'WebSite', '@id': origin + '/#website', name: 'Сибирские Деликатесы', url: origin + '/', inLanguage: 'ru-RU', publisher: { '@id': storeRef } });
  }
  nodes.push({ '@type': product ? 'ItemPage' : path.startsWith('/catalog.html') ? 'CollectionPage' : 'WebPage', '@id': url + '#webpage', url, name: title, description, inLanguage: 'ru-RU', isPartOf: { '@id': origin + '/#website' } });
  if (product) {
    const price = Number(product.price);
    const productNode = { '@type': 'Product', '@id': url + '#product', name: product.name, url, description: product.description || product.shortDescription || product.name };
    if (typeof product.sku === 'string' && product.sku) productNode.sku = product.sku;
    const image = absoluteImage(origin, product.primaryImage?.url || product.images?.[0]?.url);
    if (image) productNode.image = [image];
    if (product.category?.name) productNode.category = product.category.name;
    if (Number.isFinite(price) && price > 0) {
      productNode.offers = {
        '@type': 'Offer', url, price: String(product.price), priceCurrency: 'RUB',
        availability: product.isAvailable && product.stockState !== 'out' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      };
    }
    if (product.rating?.count > 0 && Number.isFinite(Number(product.rating.average)) && Number(product.rating.average) >= 1 && Number(product.rating.average) <= 5) {
      productNode.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(product.rating.average), ratingCount: product.rating.count, bestRating: 5, worstRating: 1 };
    }
    nodes.push(productNode);
    nodes.push(breadcrumbs(origin, path, product.name, product.category?.name && product.category?.slug ? { name: product.category.name, path: `/catalog.html?category=${encodeURIComponent(product.category.slug)}` } : { name: 'Каталог', path: '/catalog.html' }));
  } else if (category) {
    nodes.push(breadcrumbs(origin, path, category.name, { name: 'Каталог', path: '/catalog.html' }));
  } else if (path !== '/') {
    const shortTitle = title.split(' — ')[0].trim();
    nodes.push(breadcrumbs(origin, path, shortTitle));
  }
  return jsonLd(nodes);
}
