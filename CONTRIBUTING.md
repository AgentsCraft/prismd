# Contributing to prismd

Thank you for your interest in contributing to prismd! This document provides guidelines and instructions for setting up your local environment, developing features, writing tests, and submitting pull requests.

---

## 1. Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please treat all contributors with respect and kindness.

---

## 2. Prerequisites & Environment

- **Node.js**: `>= 23.4.0` (required for native `node:sqlite` DatabaseSync support)
- **npm**: `>= 10.0.0`
- **Git**: `>= 2.30.0`

### Local Setup

```bash
# Clone the repository
git clone https://github.com/AgentsCraft/prismd.git
cd prismd

# Install dependencies
npm install

# Configure git security hooks (one-time setup per machine)
git config core.hooksPath .githooks

# Set up local environment
cp .env.example .env
chmod 600 .env

# Generate initial runtime configuration
npm run generate:config

# Start development server with auto-reload
npm run dev
```

---

## 3. Branching Strategy (Gitflow)

We follow the **Gitflow** branching model:

| Branch | Purpose | Rule |
|---|---|---|
| `main` | Production release line | Only merged from `develop` or `hotfix/*` |
| `develop` | Active development branch | Base branch for all feature PRs |
| `feature/*` | New features / improvements | Branched from `develop`, merged back via PR |
| `hotfix/*` | Critical production fixes | Branched from `main`, merged back to `main` and `develop` |

> [!IMPORTANT]
> Always branch from `develop` and submit your Pull Requests targeting `develop`.

```bash
# Create a new feature branch
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name
```

---

## 4. Commit Message Guidelines

We enforce the [Conventional Commits](https://www.conventionalcommits.org/) standard. All commit messages must be in English with a summary in lowercase:

```
<type>: <short summary>

[optional body]

[optional footer(s)]
```

### Allowed Types
- `feat:` A new feature or capability
- `fix:` A bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring without behavioral change
- `test:` Adding or updating tests
- `perf:` Performance improvements
- `chore:` Build scripts, dependency updates, configuration
- `ci:` Continuous integration changes

### Examples
- `feat: add Google Gemini provider preset`
- `fix: handle connect timeout before stream starts`
- `docs: update quick start instructions in README`
- `test: add e2e test for Anthropic protocol conversion`

---

## 5. Testing & Quality Checks

All contributions must pass TypeScript checks, unit tests, and end-to-end integration tests before being merged.

```bash
# Type check
npm run typecheck

# Unit & integration tests
npm test

# Full End-to-End journey tests
npm run test:e2e

# Build verification
npm run build
```

---

## 6. Security & Secret Protection

- **Local Hooks**: Make sure `.githooks` are active (`git config core.hooksPath .githooks`). Every commit and push triggers a local `gitleaks` scan.
- **No Hardcoded Secrets**: Never commit real API keys, tokens, or personal absolute paths (`/Users/<username>`).
- **Secret Redaction**: Any logging code must redact secrets using the built-in observability utilities.

---

## 7. Submitting a Pull Request

1. Push your feature branch to GitHub:
   ```bash
   git push -u origin feature/your-feature-name
   ```
2. Open a Pull Request targeting `develop`.
3. Complete the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md) with details on changes and verification steps.
4. Ensure all GitHub Actions CI checks pass.
