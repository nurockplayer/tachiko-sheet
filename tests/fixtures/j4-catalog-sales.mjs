// Fixed Sheet-owned J4 canary source. Product build code copies these bytes
// unchanged; runtime code transports them as an opaque canonical-v1 project.
const catalogSchema = '20000000-0000-4000-8000-000000000001';
const salesSchema = '10000000-0000-4000-8000-000000000001';
const fields = { salesCode: '10000000-0000-4000-8000-000000000101', quantity: '10000000-0000-4000-8000-000000000102', code: '20000000-0000-4000-8000-000000000201', category: '20000000-0000-4000-8000-000000000202', price: '20000000-0000-4000-8000-000000000203' };
const entry = (id, key, schema, values) => JSON.stringify({id, key, schema, fields: values}) + '\n';

export const j4CanaryText = {
  'manifest.json': JSON.stringify({format: 'tachiko.roproj', format_version: 1, document: {id: '50000000-0000-4000-8000-000000000001', title: 'Sheet J4 Catalog Sales'}}, null, 2) + '\n',
  'schemas.json': JSON.stringify([
    {id: salesSchema, key: 'sales', fields: [{id: fields.salesCode, key: 'product_code', field_type: {type: 'text'}, required: true}, {id: fields.quantity, key: 'quantity', field_type: {type: 'number'}, required: true}]},
    {id: catalogSchema, key: 'catalog', fields: [{id: fields.code, key: 'code', field_type: {type: 'text'}, required: true}, {id: fields.category, key: 'category', field_type: {type: 'text'}, required: true}, {id: fields.price, key: 'price', field_type: {type: 'number'}, required: true}]},
  ], null, 2) + '\n',
  'entities/1.jsonl': entry('30000000-0000-4000-8000-000000000002', 'catalog_note', catalogSchema, {[fields.code]: {kind: 'text', value: 'NOTE'}, [fields.category]: {kind: 'text', value: 'NOTE'}, [fields.price]: {kind: 'number', value: 500}}),
  'entities/4.jsonl': entry('40000000-0000-4000-8000-000000000002', 'sale_note', salesSchema, {[fields.salesCode]: {kind: 'text', value: 'NOTE'}, [fields.quantity]: {kind: 'number', value: 2}}),
  'entities/6.jsonl': entry('40000000-0000-4000-8000-000000000001', 'sale_pen_3', salesSchema, {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 3}}),
  'entities/a.jsonl': entry('40000000-0000-4000-8000-000000000003', 'sale_pen_1', salesSchema, {[fields.salesCode]: {kind: 'text', value: 'PEN'}, [fields.quantity]: {kind: 'number', value: 1}}),
  'entities/b.jsonl': entry('30000000-0000-4000-8000-000000000001', 'catalog_pen', catalogSchema, {[fields.code]: {kind: 'text', value: 'PEN'}, [fields.category]: {kind: 'text', value: 'PEN'}, [fields.price]: {kind: 'number', value: 200}}),
};
for (const shard of '0123456789abcdef') j4CanaryText[`entities/${shard}.jsonl`] ??= '';

export const j4CanaryInventory = Object.keys(j4CanaryText).sort();
