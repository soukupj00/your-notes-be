---
aside: false
---

# API

Všechny routy jsou pod `/api` kromě `/health` a každý jiný `GET` dostane aplikaci.
Klient začíná na `GET /api`, HAL dokumentu, jehož `_links` pojmenovávají všechny routy, a stránky přehledu (feed) nesou vlastní odkazy, `next` a `resume`.
Každá chyba odchází jako RFC 9457 problem details, `application/problem+json`, jak popisuje [HTTP](../architecture/http.md#problem-details).
Přihlášení heslem nebo párovacím kódem nastaví cookie `younotes_session` (`HttpOnly`, `Secure`, `SameSite=Lax`), kterou server uchovává jen jako SHA-256 hash, a nebezpečný požadavek z jiného webu je odmítnut podle hlavičky `Sec-Fetch-Site`.

Synchronizace jsou dvě routy a jeden stream.
`POST /api/changes` odešle (push) jednu dávku poznámek, štítků, NoteTagů a tombstonů (záznamů o smazání) a na každý řádek odpoví `accepted`, `conflict` nebo `gone`.
`GET /api/changes?since=<seq>` stránkuje to, co se změnilo po daném pořadovém čísle (Sequence), s `ETag`, a odpoví `410 Gone`, když je kurzor starší než uklizený tombstone nebo obnova ze zálohy, takže se zařízení resynchronizuje od 0.
`GET /api/changes/stream` po každém pushi z jiného zařízení pošle Server-Sent Event s novým pořadovým číslem.
Bajty příloh putují odděleně od poznámek, přes `/api/blobs/:id`; pravidla jsou v [Synchronizaci](../architecture/sync.md) a [Blobech](../architecture/blobs.md).

## Reference

Běžící server ukazuje tutéž referenci na `/api/docs`.
Dokument, ze kterého vychází, je [`openapi.json`](../../openapi.json){target="_self"}, připravený k importu do libovolného HTTP klienta.

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
