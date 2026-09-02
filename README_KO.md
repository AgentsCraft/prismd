# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

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
3. **로컬 Ollama 제로 다운타임 오프라인 대체**: 클라우드 무료 할당량이 소진되거나 네트워크 연결이 끊기면 로컬 Ollama(`qwen2.5-coder:7b`, `deepseek-r1:8b`)로 매끄럽게 자동 대체됩니다.
4. **전체 프로토콜 양방향 스트리밍 변환**: Claude Code(Messages), Codex(Responses), Cursor/OpenCode(Chat Completions) 간의 투명한 중계를 완벽 지원합니다.
5. **내장 Web 대시보드 및 SIGHUP 핫 리로드**: `http://127.0.0.1:8787/ui`에서 실시간 상태와 할당량을 모니터링하고, 설정 변경 시 `SIGHUP` 신호로 무중단 갱신이 가능합니다.

---

## 지원

prismd가 시간이나 토큰 비용을 절약하는 데 도움이 되었다면, 커피 한 잔 후원을 고려해 주세요:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3단계 빠른 시작

### 1단계: 설치 및 실행

```bash
# 옵션 A: npm 글로벌 설치 (권장)
npm install -g @prismd/prismd

# 옵션 B: 소스코드 실행
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### 2단계: API Key 설정

`~/.prismd/keys.yaml` 또는 `./.env` 파일에 무료 API Key를 설정합니다 (하나 이상 설정 가능, 미설정 제공자는 자동 건너뜀):

```yaml
# ~/.prismd/keys.yaml (권장 권한: chmod 600)
prismd: "my-local-secret"       # 로컬 보호 토큰 (클라이언트 연결용)

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
prismd
# 또는 소스 모드: npm run generate:config && npm run dev
```

> 📖 **제공자별 설정 가이드**: [모델 제공자 연동 총괄 가이드](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md))를 참조하세요.

### 3단계: 에이전트 클라이언트 설정

| 클라이언트 | 빠른 설정 | 가이드 |
|---|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="my-local-secret"`<br>`claude` | [가이드](examples/claude-code/README.md) |
| **Codex CLI** | `PRISMD_API_KEY=my-local-secret codex --profile prismd` | [가이드](examples/codex/README.md) |
| **Cursor** | Settings → Models → OpenAI API Key 활성화 (`my-local-secret` 입력)<br>**Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>모델 추가: `free-auto` | [가이드](examples/cursor/README.md) |
| **OpenCode** | `~/.config/opencode/config.json`에서 `baseUrl: "http://127.0.0.1:8787/v1"` 설정 | [가이드](examples/opencode/README.md) |
| **DeepSeek Harness (dsh)** | `~/.dsh/config.toml`에서 `base_url = "http://127.0.0.1:8787/v1"` 설정<br>`PRISMD_API_KEY=my-local-secret dsh --model prismd:free-auto` | [가이드](examples/dsh/README.md) |
| **Pi Agent** | `~/.pi/config.json`에서 `endpoint: "http://127.0.0.1:8787/v1"` 설정<br>`pi run` | [가이드](examples/pi/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="my-local-secret"` `aider --model openai/free-auto` | [가이드](examples/aider/README.md) |

> 📖 **전체 문서**: [클라이언트 연동 가이드 및 프로토콜 상세](docs/clients/README.md)를 참조하세요.

---

## 기능 상세

### 1. 지능형 라우팅 및 무중단 장애 조치

prismd는 다차원 평가 파이프라인을 통해 요청마다 최적의 후보 모델을 동적으로 선택합니다:

- **컨텍스트 윈도우 검증 (Context Window Check)**: 전송 전 입력 토큰 수를 사전 추정하여 컨텍스트가 부족한 모델을 자동 제외(400 Context Overflow 오류 사전 방지).
- **소프트 할당량 우선순위 강등 (Quota-Weighted Soft Limit)**: 일일 할당량 80%(`quotaSoftLimitRatio`)에 도달한 모델은 큐의 후순위로 자동 배치되어 고우선순위 작업을 위한 잔여량을 보존.
- **무중단 429 장애 조치 (Zero-Crash Failover)**: 업스트림에서 429 속도 제한 또는 5xx 오류 반환 시 즉시 다음 후보 모델로 투명하게 재시도.
- **기본 별칭 목록**:
  - `free-auto`: 범용 코딩 모델 (Gemini 2.0 Flash / Llama 3.3 70B 우선, Ollama `qwen2.5-coder:7b`로 자동 대체).
  - `free-fast`: 초고속 경량 모델 (Gemini Flash Lite / Llama 3.1 8B).
  - `free-code`: 코드 생성 특화 모델 큐.

### 2. 다중 Key 풀과 서킷 브레이커 (Key Pool)

모든 클라우드 제공자(Groq, Cerebras, Google Gemini, OpenRouter, NVIDIA NIM, GitHub Models 등)에서 다중 Key 라운드로빈 요청 분배와 단일 Key 격리 냉각을 지원합니다:

- **`~/.prismd/keys.yaml` 형식** (목록 또는 인라인 배열):
  ```yaml
  groq:
    - "gsk_key1_xxxx"
    - "gsk_key2_xxxx"
  cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
  gemini:
    - "AIzaSy_key1_xxxx"
    - "AIzaSy_key2_xxxx"
  ```
- **`.env` 또는 환경 변수** (쉼표로 구분):
  ```bash
  GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
  GEMINI_API_KEY="AIzaSy1,AIzaSy2"
  ```
- **작동 방식**: 라운드로빈 방식으로 정상 Key들에 요청을 분산합니다. 특정 Key(예: `gsk_key1`)가 429 속도 제한 오류를 받으면 해당 Key만 냉각 기간(`Retry-After` 준수)에 들어가며, 후속 요청은 즉시 다음 정상 Key(`gsk_key2`) 또는 다음 후보 모델로 자동 전환됩니다.

### 3. 로컬 LLM 무중단 오프라인 대체 (Ollama & LM Studio)

클라우드 할당량 소진 또는 오프라인 상태 시 자동으로 로컬 추론 백엔드로 요청을 라우팅합니다:

- **Ollama**: 내장 제로 설정 제공자 (`http://127.0.0.1:11434/v1`):
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- **LM Studio**: 로컬 OpenAI 호환 서버 (`http://127.0.0.1:1234/v1`)에서 GGUF 모델 구동. [LM Studio 가이드](docs/providers/lmstudio.md) 참조.
- 에이전트 작업이 중단 없이 안전하게 완료됩니다.

### 4. 전 프로토콜 투명 변환 브리지

주요 3대 에이전트 프로토콜 간 양방향 스트리밍 변환을 완벽 지원합니다:
- **Anthropic Messages** (`POST /v1/messages`): Claude Code (도구 호출, Thinking 블록, SSE 스트림) 지원.
- **OpenAI Responses** (`POST /v1/responses`): Codex CLI 및 DeepSeek Harness (`dsh`) 호환.
- **OpenAI Chat Completions** (`POST /v1/chat/completions`): Cursor, OpenCode, Pi Agent, Aider 표준 인터페이스.

### 5. 사용자 정의 설정 확장 (`config.user.json`)

사용자 정의 제공자, 프라이빗 모델, 별칭 큐를 `config.user.json`에서 자유롭게 선언:

```jsonc
{
  "models": {
    "my-custom-model": {
      "provider": "openrouter",
      "contextWindow": 131072,
      "maxOutputTokens": 8192,
      "supportsTools": true,
      "supportsReasoning": false,
      "limits": { "dailyRequests": 100, "rpm": 20, "maxConcurrent": 2 }
    }
  },
  "aliases": {
    "free-auto": {
      "candidates": ["my-custom-model", "gemini-2.0-flash", "qwen2.5-coder:7b"]
    }
  }
}
```
`npm run generate:config`로 구성을 다시 생성합니다.

### 6. 동적 설정 핫 리로드 (`SIGHUP`)

연결 중단 없이 라우팅 테이블과 Key 구성을 즉시 갱신:
```bash
kill -HUP $(pgrep -f "prismd")
```

---

## 모니터링 및 Web 대시보드

- **Web 대시보드**: 브라우저에서 `http://127.0.0.1:8787/ui` 접속:
  - 모델 실시간 상태 (`healthy` / `rate_limited` / `cooldown`)
  - 일일 할당량 진행률 및 토큰 사용량 통계
  - 10개 언어 지원 및 "사용량 초기화 (Reset usage)" 버튼
- **CLI 상태 확인**:
  ```bash
  prismd status
  ```
  터미널 컬러 매트릭스로 확인.

---

## 문제 해결

- **Q: `missing API key for provider` 오류 발생 시**
  - `~/.prismd/keys.yaml` 또는 `.env` 파일 설정을 확인하고 `npm run generate:config`를 실행하세요.
- **Q: 무료 모델에서 429 오류가 빈번한 경우**
  - 해당 제공자의 다중 Key를 등록하거나 `ollama run qwen2.5-coder:7b`를 실행해 로컬 백업을 활성화하세요.
- **Q: 일일 사용량 카운터를 초기화하려면?**
  - Web 대시보드에서 "Reset usage"를 클릭하거나 `data/prismd.sqlite` 파일을 삭제하세요.
