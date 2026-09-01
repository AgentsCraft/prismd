# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

코딩 에이전트(Claude Code, Codex CLI, OpenCode 등)를 위해 무료 및 저비용 모델 API(OpenRouter, Groq, Cerebras 등)를 통합하는 로컬 우선 LLM 게이트웨이입니다. 자동 라우팅 및 장애 조치(Failover) 기능을 갖춘 안정적이고 일관된 인터페이스를 제공합니다.

단일 로컬 엔드포인트와 통합 별칭(`free-auto`)만 지정하면 prismd가 다음 작업을 자동으로 처리합니다:
- **스마트 라우팅 및 할당량 보호**: 입력 컨텍스트 윈도우 및 일일 할당량 사용량에 따라 사용 가능한 후보 모델을 자동 선택. 일일 할당량 소비가 80%에 도달하면 대기열 후순위로 소프트 강등.
- **원활한 장애 조치 (Failover)**: 스트림 시작 전 429/401/5xx 오류 또는 네트워크 타임아웃 발생 시 다음 후보 모델로 자동 전환.
- **다중 프로토콜 변환**: OpenAI Responses, OpenAI Chat Completions, Anthropic Messages 프로토콜을 기본 지원하여 모든 코딩 에이전트가 원활하게 연결 가능.

## 후원 안내

prismd가 개발 시간이나 할당량 절약에 도움이 되었다면, 개발자에게 커피 한 잔을 후원해 주세요:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 빠른 시작

### 방법 1: npm을 통한 전역 설치 (권장)

```bash
# 안정 버전 설치
npm install -g @prismd/prismd

# 또는 RC 프리뷰 채널
# npm install -g @agentscraft/prismd

# 프로바이더 키 및 로컬 게이트웨이 토큰 구성
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # 로컬 인증 토큰 (예: openssl rand -hex 32)

# 게이트웨이 시작 (127.0.0.1:8787 수신 대기)
prismd
```

### 방법 2: 소스 코드에서 실행

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # API 키 입력 후 chmod 600
npm run generate:config                    # 프리셋과 키를 병합하여 prismd.json 생성
npm run dev                                # 개발 서버 시작
```

### 동작 확인 (스모크 테스트)

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## 클라이언트 설정

모든 클라이언트 에이전트는 로컬 게이트웨이 엔드포인트를 지정하고 동일한 로컬 보호 토큰(`PRISMD_API_KEY`)을 사용합니다.

### 1. Claude Code
Claude Code는 환경 변수를 통해 커스텀 Anthropic 엔드포인트를 기본 지원합니다. 표준 모델명(`claude-*-sonnet` 등)은 설정된 게이트웨이 별칭으로 자동 변환됩니다:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
샘플 프로필을 복사하고 모델 메타데이터 카탈로그를 생성합니다:
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # ~/.codex/prismd-models.json 생성
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
Cursor에서 사용자 지정 OpenAI 엔드포인트를 구성합니다:
- **Settings** → **Models** → **OpenAI API Key** 활성화 후 `<your-prismd-local-token>` 입력.
- **Override OpenAI Base URL** 체크 후 `http://127.0.0.1:8787/v1` 입력.
- 모델 `free-auto`, `free-fast`, `free-code` 추가 및 활성화. [Cursor 설정 가이드](examples/cursor/README.md) 참조.

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**: `~/.config/opencode/config.json`에서 `baseUrl: "http://127.0.0.1:8787/v1"` 설정. [OpenCode 설정 가이드](examples/opencode/README.md) 참조.
- **DeepSeek Harness (dsh)**: `~/.dsh/config.toml`에서 `base_url = "http://127.0.0.1:8787/v1"` 설정. [dsh 설정 가이드](examples/dsh/README.md) 참조.
- **Pi Agent**: `~/.pi/config.json`에서 `endpoint: "http://127.0.0.1:8787/v1"` 설정. [Pi 설정 가이드](examples/pi/README.md) 참조.

---

## 키 관리 및 구성

### API 키 관리
키는 프로젝트 루트의 `.env` 또는 글로벌 `~/.prismd/` 디렉터리에서 구성할 수 있습니다. 조회 우선순위(높음 → 낮음):
1. **환경 변수**: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` 등
2. **프로젝트 루트 디렉터리**: `./.env` (`.env.example`에서 복사)
3. **글로벌 사용자 디렉터리**: `~/.prismd/.env` 또는 `~/.prismd/keys.yaml` (권장 권한: `chmod 600`)

### 후보 모델 및 우선순위 커스터마이징
`config.user.json`에서 후보 모델 우선순위 변경이나 사용자 지정 모델 추가를 진행한 후 설정을 재생성합니다:
```jsonc
{
  "aliases": {
    "free-auto": {
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,
    "connectTimeoutMs": 5000
  }
}
```
변경 사항을 적용하려면 `npm run generate:config`(또는 `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`)를 실행하십시오.

주요 무료 프로바이더(OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models 등)의 상세 설정 방법은 [프로바이더 설정 가이드](docs/providers/README.md)를 참조하세요.

---

## 상태 모니터링 및 관측 가능성

- **Web 대시보드**: 브라우저에서 `http://127.0.0.1:8787/ui`를 열어 후보 모델 헬스 상태, 일일 할당량 진행률 표시줄, 토큰 사용량 및 실시간 SSE 이벤트 로그를 확인합니다.
- **CLI 상태**: `prismd status`(또는 `npm run status`)를 실행하여 터미널에서 컬러 지표 테이블을 확인합니다.
- **구조화된 로그**: stderr로 JSON 로그 출력. 민감한 정보는 자동 마스킹되며 고유한 `request-id`로 추적 가능합니다.

---

## 동작 원리 및 제한 사항

1. **라우팅 및 필터링**:
   - 구성된 순서대로 후보 모델 시도;
   - 할당량 소진, 컨텍스트 윈도우 부족 또는 쿨다운 중인 후보 모델 하드 제외;
   - 일일 할당량 80% 이상 소진 시 대기열 후순위로 소프트 강등.
2. **장애 조치 (Failover) 경계**:
   - **스트림 시작 전**: 401/403/429/5xx 오류 또는 연결 타임아웃 시 최대 `maxCandidatesPerRequest`회까지 다음 후보 시도.
   - **스트림 시작 후**: 출력 왜곡을 방지하기 위해 스트림 도중 재시도하지 않고 SSE `error` 이벤트를 발생시키며 정상 종료.
3. **무료 풀 제한 사항**:
   - 공용 무료 모델은 공유 동시성 풀을 사용하므로 사용량이 많은 시간대에 429가 발생하기 쉽습니다. prismd는 자동으로 우회하지만, 모든 후보가 소진되면 `error.metadata`에 세부 상태를 포함하여 429를 반환합니다.

---

## 자주 묻는 질문 및 문제 해결

- **429 오류가 자주 발생함**: 무료 모델 풀이 혼잡합니다. `config.user.json`에서 `free-auto` 순서를 조정하여 덜 혼잡한 모델을 우선시하거나 다른 프로바이더 API 키를 추가하십시오.
- **업그레이드 후 후보 모델이 사라짐**: 이전 버전과 설정 키 필드가 다릅니다. `npm run generate:config`를 실행하여 `prismd.json`을 갱신하십시오.
- **할당량 카운터 초기화**: Web 대시보드(`http://127.0.0.1:8787/ui`)의 "Reset usage" 버튼을 클릭하거나 게이트웨이를 중지하고 `data/prismd.sqlite`를 삭제하십시오.
