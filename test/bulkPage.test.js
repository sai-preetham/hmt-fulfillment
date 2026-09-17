import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function renderBulkPage() {
  const { code } = transformSync(readFileSync(new URL('../app/bulk/page.jsx', import.meta.url), 'utf8'), {
    filename: 'page.jsx',
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' },
    module: { type: 'commonjs' }
  });
  const exports = {};
  runInNewContext(code, { exports, require });
  return renderToStaticMarkup(React.createElement(exports.default));
}

test('bulk route embeds the published Hold My Throttle B2B document', () => {
  const html = renderBulkPage();
  assert.match(html, /<iframe/);
  assert.match(html, /title="Hold My Throttle B2B bulk orders"/);
  assert.match(html, /docs\.google\.com\/document\/d\/e\/2PACX-1vTE-FPnxSnyqrvh9NlHgRJPQXtctGxt4DSJRFTudmBTTLKKDJ2XkiQGYxPkz_NWyQa6kJ64OcgP7pNM\/pub\?embedded=true/);
});
