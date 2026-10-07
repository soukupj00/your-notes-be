import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const repo = 'https://github.com/soukupj00/your-notes-be';

// VitePress's own slugify without the "_" it puts before a leading digit, so a numbered heading
// keeps the anchor GitHub gives it and setup.md#8-back-up-and-restore works in both places.
const slugify = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const forDevelopers = [
  {
    text: 'For developers',
    link: '/developers/',
    items: [{ text: 'The API', link: '/developers/api' }],
  },
  {
    text: 'Architecture',
    link: '/architecture/',
    items: [
      { text: 'Structure', link: '/architecture/structure' },
      { text: 'Adding a Store', link: '/architecture/adding-a-store' },
      { text: 'Sync', link: '/architecture/sync' },
      { text: 'Transactions and locks', link: '/architecture/transactions' },
      { text: 'Blobs', link: '/architecture/blobs' },
      { text: 'HTTP', link: '/architecture/http' },
      { text: 'Testing', link: '/architecture/testing' },
    ],
  },
  {
    text: 'Decisions',
    link: '/adr/',
    items: [
      {
        text: '0001 The Owner is created by a printed Pairing Link',
        link: '/adr/0001-the-owner-is-created-by-a-printed-pairing-link',
      },
      {
        text: '0002 The change feed is read from the rows, not from a log',
        link: '/adr/0002-the-change-feed-is-read-from-the-rows-not-from-a-log',
      },
      {
        text: '0003 Attachment metadata is a column on the Note',
        link: '/adr/0003-attachment-metadata-is-a-column-on-the-note',
      },
      {
        text: '0004 The backend image takes the PWA from the frontend image',
        link: '/adr/0004-the-backend-image-takes-the-pwa-from-the-frontend-image',
      },
      {
        text: '0005 Share Link tokens are stored in clear',
        link: '/adr/0005-share-link-tokens-are-stored-in-clear',
      },
      {
        text: '0006 Records and bytes sit behind two async interfaces',
        link: '/adr/0006-records-and-bytes-sit-behind-two-async-interfaces',
      },
      {
        text: '0007 A feature is a module of routes, a service and presenters',
        link: '/adr/0007-a-feature-is-a-module-of-routes-a-service-and-presenters',
      },
    ],
  },
];

const config = withMermaid(
  defineConfig({
    title: 'YouNotes Server',
    description: 'Your notes, synced by a server you run at home.',
    base: '/your-notes-be/',
    srcExclude: ['superpowers/**'],
    // GitHub shows a folder's README.md; the site serves the same file as the section's index.
    rewrites: { 'architecture/README.md': 'architecture/index.md' },
    markdown: { anchor: { slugify } },
    // A label is sized for Mermaid's line height; VitePress's 28px for every paragraph clips it.
    mermaid: { themeCSS: 'p { line-height: 1.5; }' },
    themeConfig: {
      nav: [
        { text: 'Home', link: '/' },
        { text: 'How it works', link: '/how-it-works' },
        { text: 'Set it up', link: '/setup', activeMatch: '^/setup' },
        {
          text: 'For developers',
          link: '/developers/',
          activeMatch: '^/(developers|architecture|adr)/',
        },
      ],
      socialLinks: [{ icon: 'github', link: repo, ariaLabel: 'The server on GitHub' }],
      sidebar: {
        '/developers/': forDevelopers,
        '/architecture/': forDevelopers,
        '/adr/': forDevelopers,
        '/': [
          {
            text: 'For everyone',
            items: [
              { text: 'How it works', link: '/how-it-works' },
              { text: 'Set it up at home', link: '/setup' },
              { text: 'PostgreSQL or an S3 bucket', link: '/setup-backends' },
            ],
          },
        ],
      },
      outline: [2, 3],
      search: { provider: 'local' },
      footer: {
        message: `Released under the <a href="${repo}/blob/main/LICENSE">MIT License</a>.`,
        copyright:
          '<img src="https://fit.cvut.cz/static/images/fit-cvut-logo-en.svg" alt="FIT CTU logo" style="height: 56px; margin: 8px auto">Developed with the support of the <a href="https://fit.cvut.cz/en">Faculty of Information Technology, Czech Technical University in Prague</a>.',
      },
    },
  })
);

// pnpm does not hoist mermaid's own dependencies, so the plugin's list of them fails to resolve
// and the dev server serves dayjs unconverted; pre-bundling mermaid itself converts them all.
config.vite!.optimizeDeps!.include = ['mermaid'];

export default config;
