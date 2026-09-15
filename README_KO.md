# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

**로컬 우선 고가용성 LLM 게이트웨이**. 전 세계의 무료/저비용 모델 API(OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models 등)와 로컬 LLM(Ollama)을 집약하여 코딩 에이전트(Claude Code, Codex CLI, Cursor, OpenCode, Aider 등)에 무중단 통합 인터페이스를 제공합니다.

```text
┌────────────────────────────────┐       ┌─────────────────────────────────────┐       ┌─────────────────────────────────────┐
│    Coding Agents (Clients)     │       │        prismd Gateway (Local)       │       │         Model Providers (Upstream)  │
│                                │       │          127.0.0.1:8787             │       │                                     │
│  Claude Code  (Messages API)   ├──────►│  [Protocol Converter]               ├──────►│  Cloud Free APIs                    │
│  Codex CLI    (Responses API)  ├──────►│    • Messages ↔ Responses ↔ Chat    │       │    • OpenRouter / Groq / Cerebras   │
│  Cursor / dsh (Chat API)       ├──────►│  [Smart Router (free-auto)]         │       │    • Google Gemini / NVIDIA NIM     │
│  OpenCode / Pi / Aider         ├──────►│    • Quota-Weighted & Context Check │       │    • GitHub Models / AMD            │
│                                │       │  [Key Pool & Circuit Breaker]       │       │                                     │
│                                │       │    • Multi-Key Round-Robin / 429    │  all  │  Local Offline Fallback             │
│                                │       │    • Zero-Downtime Auto Fallback    ├──────►│    • Ollama (qwen2.5-coder / r1)    │
│                                │       │                                     │  429  │    • LM Studio (local GGUF models)  │
└────────────────────────────────┘       └─────────────────────────────────────┘       └─────────────────────────────────────┘
```

---

## 핵심 기능

1. **통합 모델 별칭 (`free-auto`)**: 모델 선택의 번거로움 없이 단일 별칭으로 최적의 무료 모델에 자동 연결합니다.
2. **다중 Key 라운드 로빈 및 장애 격리 (Key Pool)**: 단일 계정의 요청 제한(RPM)을 극복. 여러 Key를 등록하여 부하를 분산하고, 단일 Key가 429에 도달하면 해당 Key만 쿨다운하며 다음 Key로 즉시 전환합니다.
3. **로컬 폴백(선택, Ollama / LM Studio)**: 기본 별칭은 클라우드 전용입니다. 로컬 백엔드를 실행 중이라면 `config.user.json`으로 큐에 추가하세요. 클라우드 무료 모델이 소진되거나 네트워크가 끊기면 요청이 로컬 모델로 대체됩니다.
4. **전체 프로토콜 양방향 스트리밍 변환**: Claude Code(Messages), Codex(Responses), Cursor/OpenCode(Chat Completions) 간의 투명한 중계를 완벽 지원합니다.
5. **내장 Web 대시보드 및 SIGHUP 핫 리로드**: `http://127.0.0.1:8787/ui`에서 실시간 상태와 할당량을 모니터링하고, 설정 변경 시 `SIGHUP` 신호로 무중단 갱신이 가능합니다.

---

## 지원

prismd가 시간이나 토큰 비용을 절약하는 데 도움이 되었다면, 커피 한 잔 후원을 고려해 주세요:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3단계 빠른 시작

### 1단계: 설치

```bash
# 옵션 A: npm 글로벌 설치
npm install -g @prismd/prismd              # 안정화 정식 버전 (Stable)
# 또는 RC 미리보기 버전 설치 (최신 develop 브랜치 연동):
npm install -g @agentscraft/prismd         # RC 채널

# 옵션 B: 소스코드 실행
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

### 2단계: 초기화 및 실행

대화형 설정 마법사를 실행하여 키와 클라이언트를 설정합니다:
```bash
prismd init
# Source install: node dist/server.js init
```
마법사 제공 기능:
1. 로컬 보호 토큰(`prismd:`) 설정.
2. 무료 제공자(OpenRouter, Groq, Google Gemini 등)를 선택하고 API Key 입력.
3. **코딩 클라이언트 자동 설정**(Claude Code, Codex CLI, OpenCode, Pi Agent) 및 기존 설정 안전 자동 백업(`.bak.<타임스탬프>`)!

*(수동 설정을 선호하는 경우 `~/.prismd/keys.yaml`을 직접 편집하거나 `PRISMD_HOME`을 설정하세요).*

```yaml
# 수동 설정 예시: ~/.prismd/keys.yaml (권장 권한: chmod 600)
prismd: "YOUR_PRISMD_TOKEN"       # 로컬 보호 토큰 (클라이언트 연결용)

# 클라우드 제공자 (단일 Key 또는 다중 Key 라운드로빈 풀 지원):
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # 다중 Key 라운드로빈 & 격리 냉각
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # GitHub Models 개인 액세스 토큰
amd: "amd_token_xxxx"           # 선택: AMD Developer Cloud 토큰

# 로컬 오프라인 폴백:
# ollama: Key 설정 불필요 (http://127.0.0.1:11434/v1 로 자동 라우팅)
```

게이트웨이 실행:
```bash
# Global install:
prismd
# Source install: node dist/server.js
```

> 📖 **제공자별 설정 가이드**: [모델 제공자 연동 총괄 가이드](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md))를 참조하세요.

### 3단계: 에이전트 클라이언트 설정

| 클라이언트 | 빠른 시작 (`prismd init` 자동 구성) | 가이드 |
|---|---|---|
| **Claude Code** | `claude` (`~/.claude/settings.json`에 자동 구성) | [가이드](examples/claude-code/README.md) |
| **Codex CLI** | `codex` (`~/.codex/config.toml` 및 `auth.json`에 자동 구성) | [가이드](examples/codex/README.md) |
| **OpenCode** | `opencode` (`~/.config/opencode/opencode.json`에 자동 구성) | [가이드](examples/opencode/README.md) |
| **Pi Agent** | `pi` (`~/.pi/config.json`에 자동 구성) | [가이드](examples/pi/README.md) |
| **Cursor** | Settings → Models → OpenAI API Key 활성화 (`YOUR_PRISMD_TOKEN` 입력)<br>**Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>모델 추가: `free-auto` | [가이드](examples/cursor/README.md) |
| **DeepSeek Harness (dsh)** | `~/.dsh/config.toml`에서 `base_url = "http://127.0.0.1:8787/v1"` 설정<br>`PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [가이드](examples/dsh/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="YOUR_PRISMD_TOKEN"` `aider --model openai/free-auto` | [가이드](examples/aider/README.md) |

> 📖 **전체 문서**: [문서 색인](docs/README.md), [클라이언트 연동 가이드](docs/clients/README.md), [설정 가이드](docs/configuration.md)를 참조하세요.

---
