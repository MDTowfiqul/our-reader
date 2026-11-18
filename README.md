<div align="center">
  <a href="https://our-reader.vercel.app" target="_blank">
    <img src="https://raw.githubusercontent.com/MDTowfiqul/our-reader/main/apps/readest-app/src-tauri/icons/icon.png" alt="Our Reader Logo" width="20%" />
  </a>
  <h1>Our Reader</h1>
  <br>

[Our Reader][link-web-app] is a free, open-source ebook reader designed for immersive and deep reading experiences. It is a fork of [Readest](https://github.com/readest/readest), built as a modern rewrite of [Foliate](https://github.com/johnfactotum/foliate), and it leverages [Next.js 16](https://github.com/vercel/next.js) and [Tauri v2](https://github.com/tauri-apps/tauri) to deliver a smooth, cross-platform experience across macOS, Windows, Linux, Android, iOS, and the Web.

It is the reader for [Our Boighar](https://mdtowfiqul.github.io/our-boighar/) — the free library of Bengali and English Islamic books — with Pro unlocked, Google Drive backup, AI summaries, Bengali fonts, and a one-tap way back to the library.

[![Website][badge-website]][link-web-app]
[![Web App][badge-web-app]][link-web-app]
[![OS][badge-platforms]][link-web-app]
<br>
[![AGPL Licence][badge-license]](LICENSE)
[![Latest release][badge-release]][link-gh-releases]
[![Last commit][badge-last-commit]][link-gh-commits]
[![Commits][badge-commit-activity]][link-gh-pulse]

</div>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#whats-different-in-our-reader">What's Different</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#downloads">Downloads</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#troubleshooting">Troubleshooting</a> •
  <a href="#support">Support</a> •
  <a href="#license">License</a>
</p>

<div align="center">
  <a href="https://our-reader.vercel.app" target="_blank">
    <img src="./data/screenshots/landing_all_platforms.png" alt="Our Reader Banner" width="100%" />
  </a>
</div>

## Features

| **Feature**                                | **Description**                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Multi-Format Support**                   | Support EPUB, PDF, MOBI, KF8 (AZW3), FB2, CBZ, TXT, HTML, MD (Markdown)                                                                      |
| **Scroll/Page View Modes**                 | Switch between scrolling or paginated reading modes.                                                                   |
| **Full-Text Search**                       | Search inside a book or across the current library shelf to find relevant sections.                                    |
| **Annotations and Highlighting**           | Add highlights, bookmarks, and notes to enhance your reading experience and use instant mode for quicker interactions. |
| **Dictionary/Wikipedia Lookup**            | Look up words with built-in sources or import local packs, including Yomitan ZIP/RDICT, from Settings → Custom Dictionaries. |
| **[Parallel Read][link-parallel-read]**    | Read two books or documents simultaneously in a split-screen view.                                                     |
| **Customize Font and Layout**              | Adjust font, layout, theme mode, and theme colors for a personalized experience.                                       |
| **Code Syntax Highlighting**               | Read software manuals with rich coloring of code examples.                                                            |
| **File Association and Open With**         | Quickly open files in Our Reader in your file browser with one-click.                                                 |
| **Library Management**                     | Organize, sort, and manage your entire ebook library.                                                                  |
| **OPDS/Calibre Integration**               | Integrate OPDS/Calibre to access online libraries and catalogs — including the [Our Boighar catalog](https://mdtowfiqul.github.io/our-boighar/opds/catalog.xml). |
| **Web Page Clipping**                      | Open websites, sign in, and clip pages with **From Web Browser**. **From Web Novel** can reuse your browser session to import selected chapters and their images. |
| **Translate with DeepL and Yandex**        | From a single sentence to the entire book—translate instantly.                                                         |
| **Audiobook Support**                      | Extend functionality to play and manage audiobooks.                                                        |
| **Text-to-Speech (TTS) Support**           | Enjoy smooth, multilingual narration—even within a single book.                                                        |
| [**Read-Along Narration**][link-readalong] | Play embedded EPUB 3 Media Overlays with timed highlighting, or pair a reflowable EPUB locally with DRM-free MP3, M4A, or M4B narration. [Storyteller][link-storyteller] remains an option for generating phrase-aligned EPUBs. |
| **Sync and Backup**                        | Back up book files, reading progress, notes, and bookmarks to Google Drive (and Telegram).                             |
| [**Sync with Koreader**][link-kosync-wiki] | Synchronize reading progress, notes, and bookmarks with [Koreader][link-koreader] devices.                             |
| **Accessibility**                          | Provides full keyboard navigation and support for screen readers such as VoiceOver, TalkBack, NVDA, and Orca.         |
| **Visual & Focus Aids**                    | Reading ruler, paragraph-by-paragraph reading mode, and speed reading features.                                        |

## What's Different in Our Reader

Everything above comes from Readest. These are the changes made in this fork:

| **Change**                          | **What it means**                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Pro unlocked**                    | Every Pro feature is free — nothing is locked behind a payment.                                                |
| **AI summary**                      | Summarize a book or a chapter with an AI provider of your choice. The app shows which models are available and which are free vs paid. |
| **Dashboard**                       | An in-app dashboard (`/dashboard`) for your library and reading overview.                                     |
| **1–10 star rating**                | Rate each book from 1 to 10 stars.                                                                             |
| **Bengali fonts**                   | Bengali fonts bundled, so Bengali books from Our Boighar render properly.                                     |
| **Back to Boighar**                 | One tap takes you back to the [Our Boighar](https://mdtowfiqul.github.io/our-boighar/) library.               |
| **Our Boighar OPDS**                | Open any Our Boighar catalog feed directly — book pages on Our Boighar link here with one tap.                |
| **Own name, icon and previews**     | Our Reader name and icon throughout, and link previews served from this repo.                                  |
| **UX fixes**                        | Library search, pinch-zoom, and reading flows fixed after a UX audit.                                          |

## Planned Features

<div align="right">🛠 Building  |  🔄 Planned</div>

| **Feature**                     | **Description**                                                            | |
| ------------------------------- | -------------------------------------------------------------------------- | ------------ |
| **Advanced Reading Stats**      | Track reading time, pages read, and more for detailed insights.            | 🛠           |
| **Handwriting Annotations**     | Add support for handwriting annotations using a pen on compatible devices. | 🔄           |

Stay tuned for continuous improvements and updates! Contributions and suggestions are always welcome—let's build the ultimate reading experience together. 😊

## Screenshots

![Annotations](./data/screenshots/annotations.png)

![TTS](./data/screenshots/tts_speak_aloud.png)

![DeepL](./data/screenshots/deepl.png)

![Footnote](./data/screenshots/footnote_popover.png)

![Wikipedia](./data/screenshots/wikipedia_vertical.png)

![Theming Dark Mode](./data/screenshots/theming_dark_mode.png)

---

## Downloads

### Web App — no install needed

Use Our Reader right in your browser at **[https://our-reader.vercel.app][link-web-app]**.

### Android

Download the APK from the [Releases on GitHub][link-gh-releases] and install it on your phone. The current release is **v0.12.16**.

### Desktop (macOS / Windows / Linux)

There is no desktop installer published for this fork yet — use the web app, or [build from source](#getting-started) with Tauri.

## Documentation

Guides and references for using and building Our Reader live in the repository: [architecture](./apps/readest-app/docs/architecture.md),
[code layout](./apps/readest-app/docs/code-layout.md), and
[testing](./apps/readest-app/docs/testing.md).

The upstream Readest documentation also applies to most features: [https://readest.com/docs](https://readest.com/docs).

## Getting Started

The fastest way to read is the web app: open **[https://our-reader.vercel.app][link-web-app]**, add a book, and start reading.

To build Our Reader from the latest commit, see [Getting Started](./CONTRIBUTING.md#getting-started).

## Troubleshooting

### 1. Our Reader Won't Launch on Windows (Missing Edge WebView2 Runtime)

**Symptom**

- When you double-click the app, nothing happens. No window appears, and Task Manager does not show the process.

**Cause**

- Microsoft Edge WebView2 Runtime is either missing, outdated, or improperly installed on your system. Our Reader depends on WebView2 to render the interface on Windows.

**How to Fix**

1. Check if WebView2 is installed
   - Open "Add or Remove Programs" (a.k.a. Apps & features) on Windows. Look for "Microsoft Edge WebView2 Runtime."
2. Install or Update WebView2
   - Download the WebView2 Runtime directly from Microsoft: [link](https://developer.microsoft.com/en-us/microsoft-edge/webview2?form=MA13LH).
   - If you prefer an offline installer, download the offline package and run it as an Administrator.
3. Re-run Our Reader
   - After installing/updating WebView2, launch the app again.
   - If you still encounter problems, reboot your PC and try again.

**Still Stuck?**

- Open an issue in this repository with detailed logs of your environment and the steps you've taken.

### 2. Linux Fails to Launch on Wayland / Niri

Linux builds use CEF with an X11 window backend. Wayland sessions therefore need XWayland. Without a `DISPLAY`, older builds exit with `Runtime(CreateWindow)` before opening a window.

On Niri, install `xwayland-satellite` 0.7 or later using your distribution's package manager and restart your Niri session. Niri 25.08 and later can start it on demand and set `DISPLAY` for applications. See [Niri's XWayland setup instructions](https://niri-wm.github.io/niri/Xwayland.html).

From a terminal in that session, check `printenv DISPLAY`, then launch Our Reader. Setting `DISPLAY` to an arbitrary value does not start XWayland; use the value provided by your session. `--ozone-platform=wayland` cannot enable native Wayland support in this runtime, and WebKitGTK environment variables do not affect CEF.

## Contributors

Our Reader is open-source, and contributions are welcome! Feel free to open issues, suggest features, or submit pull requests. Please **review our [contributing guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before you start**.

<a href="https://github.com/MDTowfiqul/our-reader/graphs/contributors">
  <p align="left">
    <img width="500" src="https://contrib.rocks/image?repo=MDTowfiqul/our-reader" alt="A table of avatars from the project's contributors" />
  </p>
</a>

## Support

Our Reader is maintained by [MD. Towfiqul Islam](https://github.com/MDTowfiqul) as part of the [Our Family](https://mdtowfiqul.github.io/our-family/) projects, together with [Our Boighar](https://mdtowfiqul.github.io/our-boighar/) — the free library of Bengali and English Islamic books this reader is built for.

If something is wrong, open an issue in this repository.

## License

Our Reader is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See the [LICENSE](LICENSE) file for details.

It is a fork of [Readest](https://github.com/readest/readest), which is also AGPL-3.0 licensed.

The following libraries and frameworks are used in this software:

- [foliate-js](https://github.com/johnfactotum/foliate-js), which is MIT licensed.
- [zip.js](https://github.com/gildas-lormeau/zip.js), which is licensed under the BSD-3-Clause license.
- [fflate](https://github.com/101arrowz/fflate), which is MIT licensed.
- [PDF.js](https://github.com/mozilla/pdf.js), which is licensed under Apache License 2.0.
- [daisyUI](https://github.com/saadeghi/daisyui), which is MIT licensed.
- [marked](https://github.com/markedjs/marked), which is MIT licensed.
- [next.js](https://github.com/vercel/next.js), which is MIT licensed.
- [react-icons](https://github.com/react-icons/react-icons), which has various open-source licenses.
- [react](https://github.com/facebook/react), which is MIT licensed.
- [tauri](https://github.com/tauri-apps/tauri), which is MIT licensed.

The following fonts are utilized in this software, either bundled within the application or provided through web fonts:

[Bitter](https://fonts.google.com/specimen/Bitter), [Fira Code](https://fonts.google.com/specimen/Fira+Code), [Inter](https://fonts.google.com/specimen/Inter), [Literata](https://fonts.google.com/specimen/Literata), [Merriweather](https://fonts.google.com/specimen/Merriweather), [Noto Sans](https://fonts.google.com/specimen/Noto+Sans), [Roboto](https://fonts.google.com/specimen/Roboto), [LXGW WenKai](https://github.com/lxgw/LxgwWenKai), [MiSans](https://hyperos.mi.com/font/en/), [Source Han](https://github.com/adobe-fonts/source-han-sans/), [WenQuanYi Micro Hei](http://wenq.org/wqy2/)

We would also like to thank the [Web Chinese Fonts Plan](https://chinese-font.netlify.app) for offering open-source tools that enable the use of Chinese fonts on the web.

---

<div align="center" style="color: gray;">Happy reading with Our Reader!</div>

[badge-website]: https://img.shields.io/badge/website-our--reader.vercel.app-orange
[badge-web-app]: https://img.shields.io/badge/read%20online-our--reader.vercel.app-orange
[badge-license]: https://img.shields.io/badge/license-AGPL--3.0-teal
[badge-release]: https://img.shields.io/github/v/release/MDTowfiqul/our-reader?color=green
[badge-platforms]: https://img.shields.io/badge/platforms-macOS%2C%20Windows%2C%20Linux%2C%20Android%2C%20iOS%2C%20Web%2C%20PWA-green
[badge-last-commit]: https://img.shields.io/github/last-commit/MDTowfiqul/our-reader?color=blue
[badge-commit-activity]: https://img.shields.io/github/commit-activity/m/MDTowfiqul/our-reader?color=blue
[link-web-app]: https://our-reader.vercel.app
[link-gh-releases]: https://github.com/MDTowfiqul/our-reader/releases
[link-gh-commits]: https://github.com/MDTowfiqul/our-reader/commits/main
[link-gh-pulse]: https://github.com/MDTowfiqul/our-reader/pulse
[link-parallel-read]: https://readest.com/#parallel-read
[link-koreader]: https://github.com/koreader/koreader
[link-kosync-wiki]: https://github.com/readest/readest/wiki/Sync-with-Koreader-devices
[link-readalong]: https://github.com/MDTowfiqul/our-reader/blob/main/apps/readest-app/docs/read-along-narration.md
[link-storyteller]: https://storyteller-platform.dev/
