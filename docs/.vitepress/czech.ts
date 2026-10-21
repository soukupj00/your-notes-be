import type { DefaultTheme, MarkdownRenderer } from 'vitepress';

// Shared with the theme, which records the language of every page read.
export const languageKey = 'docs-language';

// Runs in <head>, before the page paints, so a Czech reader never sees the English page flash.
// The language last read wins over the browser's, so choosing English in the switcher sticks.
// Slovak readers get Czech, which they read without effort.
export const czechRedirect = (base: string) => `try {
  const path = location.pathname;
  const czech = ['cs', 'sk'];
  const preferred = localStorage.getItem('${languageKey}') ??
    navigator.languages.map((tag) => tag.split('-')[0].toLowerCase()).find((tag) => tag === 'en' || czech.includes(tag));
  if (czech.includes(preferred) && path.startsWith('${base}') && !path.startsWith('${base}cs/')) {
    location.replace('${base}cs/' + path.slice(${base.length}) + location.search + location.hash);
  }
} catch {}`;

// Czech typesetting never leaves a one-letter preposition or conjunction at the end of a line.
export function keepCzechPrepositionsAttached(md: MarkdownRenderer) {
  md.core.ruler.push('czech_nbsp', (state) => {
    if (!state.env.relativePath?.startsWith('cs/')) return;
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type === 'text') {
          token.content = token.content.replace(/(?<=^|[\s(„])([ksvzouaiKSVZOUAI]) /g, '$1\u00A0');
        }
      }
    }
  });
}

export const czechThemeConfig: DefaultTheme.Config = {
  outline: { level: [2, 3], label: 'Na této stránce' },
  docFooter: { prev: 'Předchozí stránka', next: 'Další stránka' },
  darkModeSwitchLabel: 'Vzhled',
  lightModeSwitchTitle: 'Přepnout na světlý motiv',
  darkModeSwitchTitle: 'Přepnout na tmavý motiv',
  sidebarMenuLabel: 'Menu',
  returnToTopLabel: 'Zpět nahoru',
  langMenuLabel: 'Změnit jazyk',
  skipToContentLabel: 'Přejít na obsah',
  notFound: {
    title: 'STRÁNKA NENALEZENA',
    quote: 'Tahle stránka neexistuje, nebo se přestěhovala.',
    linkLabel: 'přejít na úvodní stránku',
    linkText: 'Zpět na úvod',
  },
};

export const czechFooter = (repo: string): DefaultTheme.Footer => ({
  message: `Vydáno pod <a href="${repo}/blob/main/LICENSE">licencí MIT</a>.`,
  copyright:
    '<img src="https://fit.cvut.cz/static/images/fit-cvut-logo-cs.svg" alt="Logo FIT ČVUT" style="height: 56px; margin: 8px auto">Vyvinuto s podporou <a href="https://fit.cvut.cz/cs">Fakulty informačních technologií Českého vysokého učení technického v Praze</a>.',
});

export const czechSearch = {
  translations: {
    button: { buttonText: 'Hledat', buttonAriaLabel: 'Hledat' },
    modal: {
      displayDetails: 'Zobrazit podrobnosti',
      resetButtonTitle: 'Vymazat hledání',
      backButtonTitle: 'Zavřít hledání',
      noResultsText: 'Žádné výsledky pro',
      footer: {
        selectText: 'vybrat',
        selectKeyAriaLabel: 'Enter',
        navigateText: 'procházet',
        navigateUpKeyAriaLabel: 'šipka nahoru',
        navigateDownKeyAriaLabel: 'šipka dolů',
        closeText: 'zavřít',
        closeKeyAriaLabel: 'Escape',
      },
    },
  },
};
