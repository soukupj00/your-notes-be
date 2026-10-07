---
aside: false
---

# The API

Every route is under `/api` except `/health`, and any other `GET` gets the app.
A client starts at `GET /api`, a HAL document whose `_links` name every route, and the feed pages carry their own links, `next` and `resume`.
Every error leaves as RFC 9457 problem details, `application/problem+json`, as [HTTP](../architecture/http.md#problem-details) describes.
Signing in with a password or a Pairing Code sets the `younotes_session` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`), which the server keeps only as a SHA-256 hash, and an unsafe request from another site is refused on its `Sec-Fetch-Site` header.

Sync is two routes and a stream.
`POST /api/changes` pushes one batch of Notes, Tags, NoteTags and Tombstones and answers each row with `accepted`, `conflict` or `gone`.
`GET /api/changes?since=<seq>` pages through what changed after a Sequence, with an `ETag`, and answers `410 Gone` when the cursor predates a swept Tombstone or a restore, so the Device resyncs from 0.
`GET /api/changes/stream` sends a Server-Sent Event with the new Sequence after every push from another Device.
Attachment bytes travel apart from the Notes, through `/api/blobs/:id`; the rules are in [Sync](../architecture/sync.md) and [Blobs](../architecture/blobs.md).

## Reference

A running server shows the same reference at `/api/docs`.
The document behind it is [`openapi.json`](../openapi.json){target="_self"}, ready to import into any HTTP client.

<div id="openapi-reference"></div>

<script setup>
import { onMounted, onUnmounted, watch } from 'vue';
import { useData, withBase } from 'vitepress';

const scalar = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.0/esm.js';
const { isDark } = useData();
let reference;

// Scalar reads its dark mode only when it mounts, so a theme switch mounts it again.
async function mount() {
  const { createApiReference } = await import(/* @vite-ignore */ scalar);
  reference?.destroy();
  reference = createApiReference('#openapi-reference', {
    url: withBase('/openapi.json'),
    layout: 'classic',
    hideClientButton: true,
    hideTestRequestButton: true,
    hideDarkModeToggle: true,
    forceDarkModeState: isDark.value ? 'dark' : 'light',
    withDefaultFonts: false,
    agent: { disabled: true },
    showDeveloperTools: 'never',
    customCss: `.light-mode, .dark-mode {
      --scalar-background-1: var(--vp-c-bg);
      --scalar-background-2: var(--vp-c-bg-soft);
      --scalar-background-3: var(--vp-c-default-soft);
      --scalar-color-1: var(--vp-c-text-1);
      --scalar-color-2: var(--vp-c-text-2);
      --scalar-color-3: var(--vp-c-text-3);
      --scalar-color-accent: var(--vp-c-brand-1);
      --scalar-border-color: var(--vp-c-divider);
      --scalar-font: var(--vp-font-family-base);
      --scalar-font-code: var(--vp-font-family-mono);
    }`,
  });
}

onMounted(mount);
watch(isDark, mount);
onUnmounted(() => reference?.destroy());
</script>
