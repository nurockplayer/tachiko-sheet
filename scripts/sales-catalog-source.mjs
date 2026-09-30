// Build-only product source for the Home Sales example. It is derived from the
// fixed J4 canary inventory and changes exactly its existing title token.
import { j4CanaryInventory, j4CanaryText } from '../tests/fixtures/j4-catalog-sales.mjs';

const originalTitleToken = '"title": "Sheet J4 Catalog Sales"';
const productTitleToken = '"title": "Sales and catalog"';
const manifest = j4CanaryText['manifest.json'];
if (manifest.split(originalTitleToken).length !== 2) {
  throw new Error('J4 source manifest must contain exactly one expected document title token.');
}

export const salesCatalogInventory = j4CanaryInventory;
export const salesCatalogText = {
  ...j4CanaryText,
  'manifest.json': manifest.replace(originalTitleToken, productTitleToken),
};

if (salesCatalogText['manifest.json'].split(productTitleToken).length !== 2 ||
    salesCatalogText['manifest.json'].replace(productTitleToken, originalTitleToken) !== manifest) {
  throw new Error('Sales product manifest is not a reversible single-title substitution.');
}
