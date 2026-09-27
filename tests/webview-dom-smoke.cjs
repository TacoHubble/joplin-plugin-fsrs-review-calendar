'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../src/webview');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
const duplicateIds = [...htmlIds].filter(id => (html.match(new RegExp(`\\bid=["']${id}["']`, 'g')) ?? []).length > 1);
const referencedIds = new Set([...source.matchAll(/(?:requiredElement|input|select)\(['"]([^'"]+)['"]\)/g)].map(match => match[1]));
const missing = [...referencedIds].filter(id => !htmlIds.has(id));

if (duplicateIds.length) throw new Error(`Duplicate webview IDs: ${duplicateIds.join(', ')}`);
if (missing.length) throw new Error(`Missing webview IDs: ${missing.join(', ')}`);
console.log(`Webview DOM smoke test passed (${referencedIds.size} referenced controls).`);
