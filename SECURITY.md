# Security Policy

The prismd team takes security and secret protection seriously. This document outlines how to report security vulnerabilities and describes our built-in security mechanisms.

---

## 1. Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported |
|---|---|
| Latest Release (`main`) | :white_check_mark: |
| Latest Release Candidate (`develop`) | :white_check_mark: |
| Older Releases | :x: (Please upgrade to latest) |

---

## 2. Reporting a Vulnerability

If you discover a security vulnerability or secret leakage risk in prismd:

> [!CAUTION]
> **Do NOT file a public issue** for suspected security vulnerabilities.

### Preferred Reporting Method
- **GitHub Private Vulnerability Reporting**: Go to the **Security** tab of this repository and click **"Report a vulnerability"** to open a confidential advisory draft.
- **Email**: If you cannot use GitHub Security Advisories, contact the maintainers at `security@agentscraft.org` (or directly via maintainer profile).

### What to Include
1. A clear description of the vulnerability and its potential impact.
2. Step-by-step reproduction instructions or a minimal proof of concept (PoC).
3. Affected versions, operating system, and Node.js runtime environment.
4. Any potential mitigations or suggested fixes.

We will acknowledge receipt within 48 hours and work with you to triage, patch, and coordinate responsible disclosure.

---

## 3. Built-in Security Architecture

prismd is designed from the ground up for local-first, privacy-conscious execution:

- **Local Bearer Protection**: All incoming client requests must present a configured Bearer token (`auth.localTokenField`). Unauthorized requests (401) are terminated immediately and are never forwarded upstream.
- **Strict Secret Redaction**: All request headers containing `authorization`, `api-key`, `api_key`, or `token` are automatically sanitized to `****` in structured logs. Raw sensitive payloads are never written to disk or stdout/stderr.
- **Pre-commit & CI Leak Prevention**: Pre-commit hooks (`.githooks/pre-commit`) and GitHub Actions workflows run deterministic `gitleaks` scans across full repository history on every commit and pull request.
- **File Permissions**: Configuration and database files (`.env`, `keys.yaml`, `data/prismd.sqlite`) check for restrictive user-only permissions (`chmod 600` / `700`) and emit security warnings when world-readable.
