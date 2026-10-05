# Code Converter

![CI](https://github.com/xiaosong8584/code-converter/actions/workflows/ci.yml/badge.svg)

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

![version](https://img.shields.io/badge/version-1.7.0-green.svg)

> An Obsidian plugin that detects non-UTF-8 files in your vault and converts them to UTF-8 with safety protection, plus an experimental mojibake repair command for double-encoded text already baked into valid UTF-8 content.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Obsidian reads every note as UTF-8. Once a vault contains legacy-encoded files (GBK, Big5, Shift-JIS, UTF-16, ...), they open as garbage. This plugin provides the full **detect → backup → convert → strip BOM** loop with multiple safety valves so a false positive can never corrupt your notes irreversibly.

---

## Features

- **Strict UTF-8 validation** — valid UTF-8 files, including pure ASCII, are left untouched. Zero risk.
- **BOM detection** — UTF-8, UTF-16 LE/BE, and UTF-32 byte order marks are trusted directly.
- **Scored encoding detection** — decodes are scored across 22 candidate encodings covering 10 script families.
- **Confidence protection** — anything below the threshold (80% by default) is never converted silently; you confirm each file.
- **Automatic backup before conversion** — roll back at any time.
- **Mojibake repair (experimental)** — fixes double-encoded text such as `ÖÐÎÄ` or `涓枃` using a triple quality gate, line-by-line repair, and a before/after preview.
- **U+FFFD damage detection** — counts replacement characters and tells you plainly that the bytes are gone and cannot be recovered automatically. It never invents content.
- **10 UI languages with RTL** — Simplified Chinese, English, Japanese, Korean, Russian, French, German, Spanish, Portuguese, Arabic. The first 4 are free; the last 6 require VIP.
- **Conversion log export** — JSON or Markdown.
- **VIP (optional)** — offline Ed25519 activation codes (universal or device-bound) unlock folder batch conversion, the last 6 interface languages, and editing the file extension whitelist; they also hide the supporter banner.
- **Privacy** — no network requests and no telemetry at all.

---

## Install

1. Open **Settings → Community plugins → Browse** and install **Code Converter**.
2. Enable the plugin.

Alternatively, download the `main.js`, `manifest.json`, and `versions.json` attachments from a GitHub release, or build from source:

```bash
git clone https://github.com/xiaosong8584/code-converter.git
cd code-converter
npm install
npm run build      # produces main.js
```

Then copy the folder (or symlink it) into `your-vault/.obsidian/plugins/code-converter/` and enable it. Full instructions and troubleshooting: **[User guide](USER_GUIDE.md)** (currently Chinese only).

---

## Commands

Open the command palette (`Ctrl/Cmd + P`) and pick one of:

| Command | What it does |
| --- | --- |
| Convert current file to UTF-8 | Converts high-confidence files directly; asks for confirmation below the threshold |
| Scan and convert current folder (non-UTF-8 → UTF-8) **(VIP)** | VIP feature — converts every non-UTF-8 file in the current folder whose extension is in the whitelist (default `md;h;hpp;cpp;c;cc;py;txt`) |
| Detect encoding of current file (report only) | Reports encoding, BOM, confidence, and a preview without touching the file |
| Repair mojibake in current file (double-encoded repair, experimental) | Shows a before/after preview of the repair before writing anything |
| Export conversion log (JSON) / (Markdown) | Exports the conversion record in either format |

Key settings under **Settings → Code Converter**: auto-convert on import (on by default, permanently free — this is the plugin's core safety net against Obsidian silently saving a GBK file back as UTF-8 mojibake), file extension whitelist (default `md;h;hpp;cpp;c;cc;py;txt`, editing requires VIP), confidence threshold, auto backup and backup directory, strip UTF-8 BOM, write UTF-8 BOM, log file, damage warning threshold, interface language (last 6 are VIP), and VIP status.

---

## VIP

The core features are **free forever**: single-file conversion, encoding detection, mojibake repair, conversion log export, backups and rollback, and the first 4 interface languages.

Three features require a VIP activation code:

1. **Scan and convert current folder** (batch conversion) — marked **(VIP)** in the command palette; without VIP it only prompts and opens the activation dialog.
2. **The last 6 interface languages** (Russian, French, German, Spanish, Portuguese, Arabic) — marked **(VIP)** and disabled in the settings dropdown.
3. **Editing the file extension whitelist** — folder batch conversion is a VIP feature, so without VIP the field is disabled and always holds the default list. Note: auto-convert on import is *not* a VIP feature (see above) and works with the default whitelist for everyone.
VIP codes are offline Ed25519-signed codes. They are obtained by supporting the author through GitHub Sponsors or 爱发电 (afdian.net) — pricing is shown on those pages. There is no account, no subscription and no online check; the activation state is stored locally in `data.json`.

---

## Documentation

- **Users**: [USER_GUIDE.md](USER_GUIDE.md) — installation, commands, settings, real-world cases, capability boundaries, rollback, and VIP.
- **Developers and maintainers**: development documentation lives in the `docs` directory (architecture, encoding pool, i18n/RTL, logging, the repair algorithm, building and versioning), along with the changelog and the contribution guide.

---

## Disclosure

- **No network use. No telemetry. No data collection.** The plugin runs fully offline.
- **Static supporter banner inside the plugin's own interface.** Without an active VIP, the plugin may show a static banner supporting the author once per day after startup. It can be dismissed and will not reappear that day. It never loads remote content.
- **Payment required for some features.** Folder batch conversion, the last 6 interface languages, and editing the file extension whitelist require a VIP activation code (see [VIP](#vip)). Single-file conversion, encoding detection, mojibake repair, log export, and backups are free forever. No account or subscription is involved.
- **No file access outside the vault.**

## License

MIT (see [`LICENSE`](LICENSE))
