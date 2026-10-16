// buildProducts() must return what the merch tool's /api/products returned, record for record:
// the pages and the sales-cache fill in server.js read these fields. No network, no Snowflake.
//
// Run: npm test   (node --test)

const test = require('node:test');
const assert = require('node:assert');
const { buildProducts, fetchProductCatalog, PRODUCT_FIELDS } = require('../product-catalog');

const CATALOG = [
  { SKU: 'LP100', NAME: 'Birthday Bear', OCCASION: 'Birthday', OCCASION_GROUP: 'Celebrations', THEME: 'Animals',
    SUB_THEME: 'Bears', FORMAT: 'Card', LICENSED: true, LICENSE: null, IMAGE_URL: 'https://cdn.shopify.com/a.jpg',
    STORE_URL: 'https://www.lovepop.com/a', FIRST_DATE: '2024-01-02', PRODUCT_CONFIGURATION: 'Single', SUB_BRAND: null,
    SAS_ELIGIBLE: 1 },
  { SKU: 'LP200', NAME: 'Plain Card', OCCASION: null, OCCASION_GROUP: null, THEME: null, SUB_THEME: null, FORMAT: null,
    LICENSED: false, LICENSE: null, IMAGE_URL: null, STORE_URL: null, FIRST_DATE: null, PRODUCT_CONFIGURATION: null,
    SUB_BRAND: null, SAS_ELIGIBLE: null },
  { SKU: 'LP300', NAME: 'On Sale', LICENSED: 0, SAS_ELIGIBLE: 0 },
];
const REVENUE = [{ SKU: 'LP100', REVENUE: 1234.5, UNITS: 99 }, { SKU: 'LP300', REVENUE: 0, UNITS: 3 }];
const PRICES = [
  { SKU: 'LP100', SHOPIFY_PRICE: '14.99', COMPARE_AT_PRICE: null },
  { SKU: 'LP300', SHOPIFY_PRICE: 9.99, COMPARE_AT_PRICE: 14.99 },
];

test('fields, order and types match the merch tool records', () => {
  const [bear] = buildProducts(CATALOG, REVENUE, PRICES);
  assert.deepStrictEqual(bear, {
    sku: 'LP100', name: 'Birthday Bear', occasion: 'Birthday', occasion_group: 'Celebrations', theme: 'Animals',
    sub_theme: 'Bears', format: 'Card', sub_brand: null, image_url: 'https://cdn.shopify.com/a.jpg',
    store_url: 'https://www.lovepop.com/a', first_date: '2024-01-02', product_configuration: 'Single', license: null,
    licensed: true, sas_eligible: true, revenue: { t12m: 1234.5, units: 99 }, shopify_price: 14.99,
  });
  assert.deepStrictEqual(Object.keys(bear).slice(0, PRODUCT_FIELDS.length), PRODUCT_FIELDS);
});

test('no revenue row, or zero revenue, gives { t12m: 0, units: 0 } like the merch tool', () => {
  const [, plain, sale] = buildProducts(CATALOG, REVENUE, PRICES);
  assert.deepStrictEqual(plain.revenue, { t12m: 0, units: 0 });
  assert.deepStrictEqual(sale.revenue, { t12m: 0, units: 0 });
});

test('sale price: shopify_price is the current price, compare-at only while on sale', () => {
  const [bear, plain, sale] = buildProducts(CATALOG, REVENUE, PRICES);
  assert.strictEqual(bear.shopify_compare_at_price, undefined);
  assert.strictEqual(sale.shopify_price, 9.99);
  assert.strictEqual(sale.shopify_compare_at_price, 14.99);
  assert.strictEqual(plain.shopify_price, undefined);   // no price row
});

test('licensed is boolean; sas_eligible is true / false / null', () => {
  const [bear, plain, sale] = buildProducts(CATALOG, REVENUE, PRICES);
  assert.strictEqual(sale.licensed, false);
  assert.deepStrictEqual([bear.sas_eligible, plain.sas_eligible, sale.sas_eligible], [true, null, false]);
});

test('catalog order is kept (newest first from the query)', () => {
  assert.deepStrictEqual(buildProducts(CATALOG, REVENUE, PRICES).map(p => p.sku), ['LP100', 'LP200', 'LP300']);
});

test('fetchProductCatalog runs the three queries and refuses an empty catalog', async () => {
  const seen = [];
  const fake = async (sql) => {
    seen.push(sql);
    if (sql.includes('A_PRODUCTS_V1')) return CATALOG;
    if (sql.includes('A_ORDER_LINE_ITEMS')) return REVENUE;
    return PRICES;
  };
  assert.strictEqual((await fetchProductCatalog(fake)).length, 3);
  assert.strictEqual(seen.length, 3);
  await assert.rejects(fetchProductCatalog(async () => []), /0 active products/);
});
