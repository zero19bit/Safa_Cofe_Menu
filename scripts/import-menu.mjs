import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { configuration, gateway, rest } from '../server/supabase.mjs';
import * as v from '../server/validation.mjs';
const path=process.argv[2];if(!path)throw new Error('Usage: npm run import-menu -- data/menu.json [--sample]');
const input=JSON.parse(await readFile(path,'utf8'));
if(!Array.isArray(input.categories)||!Array.isArray(input.products))throw new Error('The file must contain categories and products arrays.');
const sample=Boolean(input.sample);
if(sample&&!process.argv.includes('--sample'))throw new Error('This file is unverified sample data. Add --sample to import it with ALL products disabled.');
const ids=new Map();
const categories=input.categories.map((c,i)=>{if(!c.id||ids.has(c.id))throw new Error('Category IDs must be present and unique.');const id=v.uuidPattern.test(c.id)?c.id:randomUUID();ids.set(c.id,id);return {id,...v.category({...c,sort_order:c.sort_order??i})};});
const seen=new Set();
const products=input.products.map((p,i)=>{const id=p.id&&v.uuidPattern.test(p.id)?p.id:randomUUID();if(seen.has(id))throw new Error('Duplicate product ID.');seen.add(id);return {id,...v.product({...p,category_id:ids.get(p.category_id)||p.category_id,sort_order:p.sort_order??i,...(sample?{status:false}:{})})};});
const db=gateway(configuration());
for(const image of new Set(products.map(p=>p.image_path).filter(Boolean))){const rows=await db(rest('media',{path:`eq.${image}`,select:'id',limit:'1'}));if(!rows.length)throw new Error('An imported image does not exist in this project. Upload images before importing.');}
const result=await db('/rest/v1/rpc/safa_import_menu',{method:'POST',body:{p_categories:categories,p_products:products}});
console.log(`Imported ${result.categories} categories and ${result.products} products in one transaction.${sample?' All sample products are disabled.':''} Menu publication setting was not changed.`);
