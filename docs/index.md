---
layout: home

hero:
  name: YourNotes Server
  text: Your notes, synced by a server you run at home
  tagline: YourNotes is a notes app for your phone and your computer. This server keeps the same notes on all of them, on a machine in your own home.
  actions:
    - theme: brand
      text: Set it up
      link: /setup
    - theme: alt
      text: How it works
      link: /how-it-works

features:
  - title: Runs on one machine at home
    details: A Raspberry Pi, an old laptop or a home storage box is enough. Docker runs the server in a sealed box, next to Caddy, which gives it the secure address phones need.
  - title: Keeps your Devices in step
    details: A Device is a phone, tablet or computer with the app signed in. Change a Note on one and it shows up on the others a few seconds later, and each keeps working offline.
  - title: Nothing leaves your home
    details: Your Notes are kept on your machine and your Devices, not on a company's computers. You decide who can reach the server.
  - title: Backups you can read
    details: One command copies everything into a folder of ordinary files, your Notes as text and your photos as they are. Keep it on a USB stick and put it back whenever you need to.
---

<div class="screenshots">

![The notes on a laptop: a shopping checklist, a photo, a drawing and a pinned Note in colour](/screenshots/notes-grid-light.png){.light-only}
![The notes on a laptop in the dark theme](/screenshots/notes-grid-dark.png){.dark-only}
![The same notes on a phone](/screenshots/mobile.png){.phone}

</div>

A Note is one thing you write in the app: a few words, a checklist, a drawing, photos or a recording.
The app itself has [its own site](https://soukupj00.github.io/your-notes-fe/), with what it can do and how to install it.
You can also try it in your browser at [your-notes-fe.vercel.app](https://your-notes-fe.vercel.app/): it works fully on one Device, and this server is what adds sync between Devices.

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
