# Security Policy

## Reporting a Vulnerability

**Do not** report security vulnerabilities via public GitHub Issues.

Use one of the following channels for private disclosure:

1. **GitHub Private Vulnerability Reporting**（推荐）
   - Go to the [Security tab](https://github.com/xiaosong8584/code-converter/security/advisories) of this repository.
   - Click "Report a vulnerability" and follow the wizard.
   - This keeps the disclosure private until we jointly agree to publish.

2. **Email**（备选）
   - Send details to the author's personal contact listed on the repository's `README.md`.
   - Please include:
     - A brief description of the vulnerability
     - Reproduction steps (if applicable)
     - Affected versions
     - Suggested mitigation (if you have one)
     - Your preferred contact method for follow-up

### ⚠️ Critical context: this plugin touches file contents

Code Converter reads and writes files in the user's Obsidian vault. A vulnerability here is **not** a "website XSS" — it can **irreversibly destroy user files**. Before reporting, please evaluate the severity:

- **Critical**: a bug that can corrupt valid UTF-8 files (defeats the plugin's core safety promise).
- **High**: a bug that can corrupt files during conversion, backup, or the log-writing path.
- **Medium**: a bug in VIP activation, VIP gating, or the ad-banner frequency logic.
- **Low**: a bug in UI, i18n, or command naming that has no data-loss vector.

## Supported Versions

Only the **latest release** receives security fixes.

| Version | Supported |
|---------|-----------|
| 1.6.x   | ✅ Current |
| <1.6    | ❌ End of life (please upgrade) |

End-of-life versions may still receive backports if the vulnerability is critical and affects vault data. Contact the author directly to discuss.

## Our commitments

- **Response within 7 days** of a confirmed vulnerability report.
- **Coordinated disclosure**: we will not release a fix publicly before the reporter has been notified and had time to update.
- **Acknowledgement**: by default we will credit the reporter in the release notes; you may request anonymity by saying so in your initial report.
- **No "works as intended"** for bugs that can destroy user files — even if a workaround exists, we will consider a defensive fix.

## Known security posture

The following safeguards are already built into the plugin. Reporting a bug in any of them is welcome:

- **`selfWritten` loop guard** — the plugin never re-processes a file it just wrote.
- **Backup before conversion** — every conversion is preceded by a local backup file.
- **Strict UTF-8 validation** — valid UTF-8 files (including pure ASCII) are never touched.
- **Confidence threshold gate** — low-confidence conversions require explicit user confirmation.
- **Mojibake repair safety valve** — the repair command refuses to write unless the before/after preview shows a real fix.
- **U+FFFD damage detection** — never invents content when the original bytes are already lost.
- **Offline VIP activation** — activation codes are Ed25519-signed, no online check, no telemetry.
- **No network requests** — the plugin makes zero outbound HTTP calls.

If any of these are found to be broken, please report via the private channels above.
