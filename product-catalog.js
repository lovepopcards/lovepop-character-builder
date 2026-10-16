/* product-catalog.js — the product library, built straight from Snowflake
   ============================================================
   Until 2026-10-16 /api/products proxied the merch tool's /api/products on Railway. The merch
   tool moved to AWS that day (admin.lovepop.com/merchandising, behind SSO) and its Railway service
   was stopped, so the proxy could only serve its last saved copy. Everything that endpoint returned
   came from Snowflake anyway, so the same three queries run here instead. They are copied from
   lovepop-merch-tool/server.js (refreshProducts, refreshSkuRevenue, refreshSkuPrice; the catalog
   query trimmed to the columns /api/products sent), and buildProducts() reproduces the merch tool's
   /api/products records field for field, so the pages and the sales-cache fill keep working unchanged.
*/

// Shopify catalog (live Airbyte sync) + A_PRODUCTS_V1 taxonomy + the SAS-eligible flag from Odoo.
const CATALOG_SQL = `
  SELECT
    v.sku,
    sp.title                                        AS name,
    tx.occasion,
    tx.occasion_group,
    tx.theme,
    tx.sub_theme,
    tx.format,
    CASE WHEN tx.lp_licensed_product = 1 THEN TRUE ELSE FALSE END AS licensed,
    tx.license_property                             AS license,
    sp.featured_image:url::TEXT                      AS image_url,
    sp.online_store_url                             AS store_url,
    tx.first_shopify_date                           AS first_date,
    tx.product_configuration,
    tx.sub_brand,
    pt.sas_eligible
  FROM ANALYTICS.AB_SHOPIFY.PRODUCT_VARIANTS v
  JOIN ANALYTICS.AB_SHOPIFY.PRODUCTS sp ON sp.id = v.product_id
  LEFT JOIN ANALYTICS.LOVEPOP.A_PRODUCTS_V1 tx ON tx.sku = v.sku
  LEFT JOIN (
    SELECT default_code, MAX(IFF(lp_sas_note, 1, 0)) AS sas_eligible
    FROM ANALYTICS.AB_ODOO_OMS.PRODUCT_TEMPLATE
    WHERE default_code IS NOT NULL
    GROUP BY default_code
  ) pt ON pt.default_code = v.sku
  WHERE v.sku IS NOT NULL
    AND v.sku != ''
    AND sp.status = 'ACTIVE'
  ORDER BY tx.first_shopify_date DESC NULLS LAST
`;

// Trailing-12-month net product revenue and units per SKU (cancelled orders and gift cards out).
const REVENUE_SQL = `
  SELECT
    oli.sku,
    SUM(oli.net_product_revenue) AS revenue,
    SUM(oli.quantity)            AS units
  FROM ANALYTICS.LOVEPOP.A_ORDER_LINE_ITEMS oli
  JOIN ANALYTICS.LOVEPOP.A_ORDERS o ON oli.order_id = o.id
  WHERE o.order_date >= DATEADD(day, -365, CURRENT_DATE)
    AND o.is_cancelled = 0
    AND (oli.gift_card_type IS NULL OR oli.gift_card_type != 'gift_card')
    AND oli.sku IS NOT NULL
  GROUP BY 1
`;

// Current Shopify price; COMPARE_AT_PRICE is the original list price, set only while on sale.
const PRICE_SQL = `
  SELECT
    sku,
    price          AS shopify_price,
    TRY_TO_NUMBER(compare_at_price) AS compare_at_price
  FROM ANALYTICS.AB_SHOPIFY.PRODUCT_VARIANTS
  WHERE sku IS NOT NULL AND sku != ''
`;

// The fields the merch tool's /api/products sent (its PRODUCT_FIELDS), in its order.
const PRODUCT_FIELDS = ['sku', 'name', 'occasion', 'occasion_group', 'theme', 'sub_theme', 'format', 'sub_brand',
  'image_url', 'store_url', 'first_date', 'product_configuration', 'license', 'licensed', 'sas_eligible'];

function lowerKeys(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = v;
  return out;
}

/** The product records from the three queries' rows (Snowflake returns UPPERCASE keys). Pure. */
function buildProducts(catalogRows, revenueRows, priceRows) {
  const revenue = new Map();
  for (const r of revenueRows.map(lowerKeys)) {
    if (r.sku) revenue.set(r.sku, { r: Number(r.revenue || 0), u: Number(r.units || 0) });
  }
  const price = new Map();
  for (const r of priceRows.map(lowerKeys)) {
    if (!r.sku) continue;
    const p = Number(r.shopify_price || 0) || null;
    const c = r.compare_at_price != null ? Number(r.compare_at_price) || null : null;
    price.set(r.sku, { p, c });
  }

  return catalogRows.map(lowerKeys).map(row => {
    row.licensed = !!row.licensed;
    // SAS-enabled flag (LP_SAS_NOTE): 1 -> true, 0 -> false, unknown -> null
    row.sas_eligible = row.sas_eligible == null ? null : Number(row.sas_eligible) === 1;

    const product = {};
    for (const f of PRODUCT_FIELDS) if (row[f] !== undefined) product[f] = row[f];
    const rev = revenue.get(row.sku);
    product.revenue = rev && rev.r ? { t12m: rev.r, units: rev.u || 0 } : { t12m: 0, units: 0 };
    const pr = price.get(row.sku);
    if (pr && pr.p != null) product.shopify_price = pr.p;
    if (pr && pr.c) product.shopify_compare_at_price = pr.c; // original list price when on sale
    return product;
  });
}

/** Run the three queries with `query(sql) -> rows` and build the catalog. Throws on an empty catalog. */
async function fetchProductCatalog(query) {
  const [catalogRows, revenueRows, priceRows] = await Promise.all([
    query(CATALOG_SQL), query(REVENUE_SQL), query(PRICE_SQL),
  ]);
  const products = buildProducts(catalogRows, revenueRows, priceRows);
  // Never replace a good cached library with nothing (the merch tool had the same guard).
  if (!products.length) throw new Error('Snowflake returned 0 active products');
  return products;
}

module.exports = { CATALOG_SQL, REVENUE_SQL, PRICE_SQL, PRODUCT_FIELDS, buildProducts, fetchProductCatalog };
