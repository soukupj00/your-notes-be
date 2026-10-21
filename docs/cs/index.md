---
layout: home

hero:
  name: Server YourNotes
  text: Vaše poznámky synchronizuje server, který si provozujete doma
  tagline: YourNotes je aplikace na poznámky pro telefon i počítač. Tento server udržuje stejné poznámky na všech vašich zařízeních, a to na počítači přímo u vás doma.
  actions:
    - theme: brand
      text: Nastavení serveru
      link: /cs/setup
    - theme: alt
      text: Jak to funguje
      link: /cs/how-it-works

features:
  - title: Běží na jednom počítači doma
    details: Stačí Raspberry Pi, starý notebook nebo domácí úložiště. Docker spouští server v uzavřeném kontejneru vedle Caddy, který mu zajistí zabezpečenou adresu, jakou telefony potřebují.
  - title: Udržuje vaše zařízení v souladu
    details: Zařízení je telefon, tablet nebo počítač s přihlášenou aplikací. Upravte poznámku na jednom a za pár sekund se objeví na ostatních, přičemž každé z nich funguje i offline.
  - title: Nic neopustí váš domov
    details: Vaše poznámky jsou uložené na vašem počítači a vašich zařízeních, ne na počítačích nějaké firmy. Sami rozhodujete, kdo se k serveru dostane.
  - title: Zálohy, které si přečtete
    details: Jeden příkaz zkopíruje vše do složky s obyčejnými soubory - poznámky jako text a fotky tak, jak jsou. Uložte si ji na USB flash disk a kdykoli ji potřebujete, vraťte ji zpět.
---

<div class="screenshots">

![Poznámky na notebooku: nákupní seznam úkolů, fotka, kresba a připnutá barevná poznámka](/screenshots/notes-grid-light.png){.light-only}
![Poznámky na notebooku v tmavém motivu](/screenshots/notes-grid-dark.png){.dark-only}
![Tytéž poznámky na telefonu](/screenshots/mobile.png){.phone}

</div>

Poznámka je jedna věc, kterou v aplikaci napíšete: pár slov, seznam úkolů, kresba, fotky nebo nahrávka.
Samotná aplikace má [vlastní web](https://soukupj00.github.io/your-notes-fe/cs/), kde se dozvíte, co umí a jak ji nainstalovat.
Vyzkoušet si ji můžete i v prohlížeči na [your-notes-fe.vercel.app](https://your-notes-fe.vercel.app/): na jednom zařízení funguje naplno a synchronizaci mezi zařízeními přidává právě tento server.

<style>
.screenshots {
  margin-top: 48px;
}
.screenshots p {
  display: flex;
  gap: 24px;
  align-items: flex-end;
}
.screenshots img {
  min-width: 0;
  border-radius: 8px;
  box-shadow: var(--vp-shadow-3);
}
.screenshots .light-only,
.screenshots .dark-only {
  flex: 4;
}
.screenshots .phone {
  flex: 1;
}
.dark .screenshots .light-only,
html:not(.dark) .screenshots .dark-only {
  display: none;
}
</style>
