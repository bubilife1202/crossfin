import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'CrossFin',
  description: 'Route capital across Korean and global exchanges',
  appearance: 'force-dark',
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Overview', link: '/' },
      { text: 'Quickstart', link: '/quickstart' },
      { text: 'API', link: '/api' },
      { text: 'MCP', link: '/mcp' },
      { text: 'Telegram', link: '/telegram' },
      { text: 'crossfin.dev', link: 'https://crossfin.dev' },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/bubilife1202/crossfin' },
    ],
  },
})
