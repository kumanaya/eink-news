import { defineConfig } from 'astro/config';

// The only reader this site is built for is the e-ink Kindle's browser: old
// WebKit, no ES6, no CSS grid, HTTPS flaky. So the output is static HTML with
// the CSS inlined (one request per page) and no client JavaScript at all.
export default defineConfig({
  output: 'static',
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
    format: 'file',
  },
  devToolbar: { enabled: false },
});
