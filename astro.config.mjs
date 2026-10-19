import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://monprojetenergie.fr',
  integrations: [sitemap({ filter: (page) => !page.includes('/admin') })],
  build: { inlineStylesheets: 'auto' },
});
