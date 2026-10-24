// Open Food Facts: free, open product database with barcodes.

const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,quantity';

function toFood(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184;
  if (kcal == null) return null;
  const name = p.product_name_en || p.product_name;
  if (!name) return null;
  const serving = parseFloat(p.serving_quantity);
  return {
    name: name.trim(),
    brand: (p.brands || '').split(',')[0].trim(),
    code: p.code,
    per100: {
      kcal: +kcal || 0,
      p: +n.proteins_100g || 0,
      c: +n.carbohydrates_100g || 0,
      f: +n.fat_100g || 0,
      fib: +n.fiber_100g || 0,
      sug: +n.sugars_100g || 0,
      na: +n.sodium_100g ? n.sodium_100g * 1000 : 0, // mg
    },
    servingG: serving > 0 ? serving : null,
    servingLabel: p.serving_size || '',
    source: 'off',
  };
}

export async function searchOFF(q, signal) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${FIELDS}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('Food search is busy. Try again shortly.');
  const j = await r.json();
  return (j.products || []).map(toFood).filter(Boolean);
}

export async function lookupBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.status === 1 ? toFood(j.product) : null;
}
