import type { Theme } from 'vitepress';
import { inBrowser, withBase } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { languageKey } from '../czech';

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (!inBrowser) return;
    router.onAfterRouteChange = (href) => {
      const { pathname } = new URL(href, location.href);
      try {
        localStorage.setItem(languageKey, pathname.startsWith(withBase('/cs/')) ? 'cs' : 'en');
      } catch {}
    };
  },
} satisfies Theme;
