# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md)

코딩 에이전트를 위해 무료/저할당량 모델 API(OpenRouter, Groq, Cerebras 등)를 통합하는 로컬 우선 LLM 게이트웨이입니다. 단 하나의 로컬 엔드포인트와 단 하나의 별칭(`free-auto`)만 지정하면 prismd가 나머지 작업을 자동으로 처리합니다: 사용 가능한 후보 모델 선택, 할당량 소진 방지, 업스트림이 429를 반환할 때의 자동 장애 조치(Failover), 게이트웨이 상태 실시간 가시화. 3대 주요 프로토콜(OpenAI Responses, OpenAI Chat Completions, Anthropic Messages)을 기본 지원하므로 Codex CLI, Claude Code, OpenCode 등의 클라이언트가 모두 동일한 게이트웨이를 공유할 수 있습니다.

## 후원 안내

prismd가 개발 시간이나 할당량 절약에 도움이 되었다면, 개발자에게 커피 한 잔을 후원해 주세요:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

## 주요 기능

| 기능 | 동작 설명 |
| --- | --- |
| **다중 프로토콜 통합 엔드포인트** | `POST /v1/responses`(OpenAI Responses, Codex용), `POST /v1/chat/completions`(OpenAI Chat, OpenCode/dsh용), `POST /v1/messages`(Anthropic Messages, Claude Code용) — 모두 동일한 별칭, 라우팅, 할당량, 장애 조치 공유 |
| **양방향 프로토콜 변환** | Chat↔Responses(아웃바운드 변환, 스트리밍 tool-call 이벤트 지원) 및 Anthropic↔Chat(인바운드 변환); 업스트림 프로토콜과 일치하는 요청은 직접 투명 통과 |
| **Claude 모델 자동 폴백** | Claude Code의 `claude-*-sonnet/haiku/opus-*` 형식 모델명을 9단계 폴백 체인(날짜 접미사, `-latest`, 시맨틱 패밀리, `free-auto`)을 통해 구성된 별칭으로 자동 확인. 설정 없이 즉시 Claude Code 동작 |
| **별칭 라우팅** | `"model": "free-auto"`는 설정 파일 내의 순서화된 후보 목록으로 확인 |
| **후보 모델 필터링** | 일일 할당량이 소진되었거나(`limits.dailyRequests`), 입력 크기가 컨텍스트 윈도우를 초과하거나, 상태 불량/쿨다운 중인 후보를 제외. 일일 할당량 80% 이상의 후보는 대기열 후순위로 소프트 강등 |
| **장애 조치 (Failover)** | *스트림 시작 전* 401/403/429/5xx/연결 오류/연결 타임아웃 발생 시 다음 후보 모델을 자동 시도(최대 `maxCandidatesPerRequest`회). 클라이언트 요청 오류인 4xx(400/404/422)는 그대로 반환. 스트림 시작 후에는 재시도 없이 즉시 종료 |
| **할당량 및 사용량 집계** | 요청 수와 토큰 수(업스트림 실제 사용량 또는 글자수÷4 추정치)를 로컬 SQLite에 저장. 재부팅 후에도 지속 유지 |
| **패시브 헬스 체크** | 3회 연속 실패 → 쿨다운 60초 → 하프 오픈(단일 프로브 시도). 401/403 인증 오류는 별도로 추적 |
| **타임아웃 제어** | 연결 타임아웃(기본값 10초) 및 스트림 유휴 타임아웃(기본값 300초), 정책별 구성 가능 |
| **API 키 관리** | 키는 `~/.prismd/`(`.env` 또는 `keys.yaml`)에서 중앙 관리. 저장소나 생성된 설정 파일에 포함되지 않음. 우선순위: OS 환경 변수 > `~/.prismd/.env` > `~/.prismd/keys.yaml` |
| **모델 탐색** | `GET /v1/models`로 구성된 논리 별칭 모델 목록을 OpenAI 호환 형식으로 조회(인증 불필요) |
| **상태 API & SSE** | `GET /healthz`(게이트웨이 상태), `GET /v1/modelstatus`(메모리 내 후보 상태 스냅샷), `GET /v1/modelstatus/stream`(헬스/할당량 변경 시 실시간 SSE 푸시) |
| **내장 Web UI** | `GET /ui`로 후보 모델 상태 배지, 할당량 진행률 표시줄, 토큰 지표, 활성 상태, 실시간 이벤트 로그를 표시하는 독립 대시보드 제공 |
| **CLI 상태** | `prismd status`(또는 `npm run status`)로 컬러 터미널 테이블 출력. 오프라인 시 SQLite에서 오늘의 기록 자동 표시 |
| **관측 가능성** | stderr에 JSON 형식 pino 구조화 로그 출력. 요청 ID 기반 추적 및 요청당 요약 기록. 비밀 키 자동 마스킹 |

## 빠른 시작

소스 코드에서 실행:

```bash
npm install
cp keys.yaml.example ~/.prismd/keys.yaml   # API 키 입력 후 chmod 600
npm run generate:config                    # 프리셋 + config.user.json + 키 → prismd.json 생성
npm run dev                                # http://127.0.0.1:8787 에서 실행
```

또는 npm 패키지로 전역 설치:

```bash
npm install -g @agentscraft/prismd
export OPENROUTER_API_KEY=<your-key>
export PRISMD_API_KEY=<local-token>        # 생성: openssl rand -hex 32
prismd                                     # http://127.0.0.1:8787 에서 실행
```

런타임은 단 하나의 설정 파일 `prismd.json`만 읽습니다(`PRISMD_CONFIG_PATH`로 경로 재정의 가능). 패키지 환경에서는 `node node_modules/@agentscraft/prismd/scripts/generate-config.mjs --root <dir>`로 생성합니다.

스모크 테스트:

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

## API 키 관리

prismd는 API 키를 `~/.prismd/` 디렉터리에서 읽습니다. 키는 절대 Git 저장소나 `prismd.json`에 포함되지 않습니다. 조회 우선순위:

| 필드 | OS 환경 변수 | `~/.prismd/.env` | `~/.prismd/keys.yaml` |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY=...` | `openrouter: ...` |
| `groq` | `GROQ_API_KEY` | `GROQ_API_KEY=...` | `groq: ...` |
| `cerebras` | `CEREBRAS_API_KEY` | `CEREBRAS_API_KEY=...` | `cerebras: ...` |
| `prismd` (로컬 토큰) | `PRISMD_API_KEY` | `PRISMD_API_KEY=...` | `prismd: ...` |

- 환경 변수 이름은 대문자 필드명 + `_API_KEY`입니다.
- `.env`(`KEY=value`) 및 `keys.yaml`(`field: value`) 형식을 모두 지원합니다. 예제 파일 `.env.example` / `keys.yaml.example`을 참조하세요.
- 파일 권한은 `chmod 600`으로 설정하십시오.
- 로컬 토큰(`prismd` 필드)은 3개의 POST 엔드포인트를 보호합니다. 요청 시 `Authorization: Bearer <token>` 또는 `x-api-key: <token>`(Claude Code 기본값)을 전달해야 합니다. 유효하지 않은 토큰은 401 오류를 반환하며 업스트림에 전달되지 않습니다.

## 구성

`prismd.json`은 직접 수정하지 않고 생성기를 통해 만들어집니다. 세 가지 레이어가 병합됩니다:

| 레이어 | 파일 | 목적 |
| --- | --- | --- |
| Presets | `presets/providers.json` | 내장 프로바이더, 무료 모델 메타데이터(컨텍스트 창, 제한, 태그), 출처 정보 및 기본 별칭. |
| User overrides | `config.user.json` | 사용자 정의 설정(별칭 우선순위, 커스텀 후보 모델, 정책, 서버 설정). 키는 포함하지 않음. |
| Keys | `~/.prismd/` | 키가 존재하는 프로바이더의 모델만 설정 파일에 포함됨. |

설정을 변경한 후 `npm run generate:config`를 실행하십시오.

`config.user.json` 재정의 예시:

```jsonc
{
  "aliases": {
    "free-auto": {
      // 후보 모델 우선순위 재정렬
      "candidates": [
        "cohere/north-mini-code:free",
        "poolside/laguna-s-2.1:free"
      ]
    }
  },
  "policies": {
    "maxCandidatesPerRequest": 3,     // 요청당 최대 3개 후보 시도
    "connectTimeoutMs": 5000          // 연결 타임아웃 단축
  }
}
```

커스텀 후보 모델 직접 정의:

```jsonc
{
  "aliases": {
    "free-code": {
      "candidates": [
        {
          "provider": "openrouter",
          "providerModelId": "some/model:free",
          "contextWindow": 131072,
          "maxOutputTokens": 8192,
          "supportsTools": true,
          "supportsReasoning": false,
          "limits": { "dailyRequests": 50, "rpm": 20, "maxConcurrent": 2 },
          "tags": ["free", "code"]
        }
      ]
    }
  }
}
```

표준 `baseUrl` 엔드포인트(`/responses` 또는 `/chat/completions`)를 가진 새로운 프로바이더를 자유롭게 추가할 수 있습니다.

## 라우팅 메커니즘

1. 별칭을 `prismd.json`의 순서화된 후보 모델 목록으로 확인합니다.
2. **하드 제외**: 일일 할당량이 소진되었거나(`limits.dailyRequests`), 입력 크기(글자수÷4)가 `contextWindow`를 초과하거나, 쿨다운 중인 모델을 제외.
3. **소프트 강등**: 일일 할당량 사용률 80% 이상(`quotaSoftLimitRatio`)인 후보를 목록 후순위로 이동.
4. 첫 번째 유효 후보 모델에 요청 전달. 실패 시 장애 조치 트리에 따라 다음 후보로 전환.

게이트웨이 자체 반환 오류(OpenAI 형식 `{"error": {...}}`):

| 상황 | 상태 코드 | 오류 코드 | 비고 |
| --- | --- | --- | --- |
| 인증 토큰 누락/불일치 | 401 | `invalid_api_key` | 업스트림 미도달 |
| 알 수 없는 별칭 | 404 | `model_not_found` | |
| 모든 후보 소진/불량 | 429 | `quota_exceeded` | `error.metadata`에 각 후보의 제외 사유 기록 |
| 입력 크기가 모든 후보의 컨텍스트 초과 | 422 | `context_window_exceeded` | `error.metadata`에 각 후보의 윈도우 크기 기록 |
| 시도한 모든 후보 실패 | 502 | `gateway_all_candidates_failed` | `error.metadata`에 각 시도의 상태 기록 |
| 내부 오류 | 500 | `gateway_internal_error` | |

## 장애 조치 (Failover)

- **트리거 조건 (스트림 시작 전)**: 연결 실패, 연결 타임아웃 및 업스트림 401, 403, 429, 5xx 응답. 실패 횟수를 기록하고(헬스 +1) 최대 `maxCandidatesPerRequest`회까지 다음 후보 시도.
- **비트리거 조건**: 400/404/422 등의 요청 오류 4xx(요청 자체에 문제가 있으므로 재시도하지 않고 그대로 반환).
- **스트림 시작 후**: 절대 재시도하지 않음. 중간에 연결이 끊기면 SSE `error` 이벤트를 발생시키고 종료.
- 429 응답에 `Retry-After` 헤더가 포함되고 `respectRetryAfter`가 켜져 있으면, 쿨다운 시간은 `max(cooldownMs, Retry-After)`로 설정됩니다.

## 할당량 및 사용량 관리

사용량은 메모리에서 집계되며 5초마다 또는 20개 레코드마다 SQLite(`data/prismd.sqlite`, WAL 모드)로 동기화됩니다. 종료 시(SIGINT/SIGTERM)에도 강제 저장됩니다.

| 테이블 | 내용 |
| --- | --- |
| `usage_daily` | 일일 집계 데이터(날짜, 프로바이더, 모델, 요청 수, 토큰 수). 시작 시 시드로 로드되어 재부팅 후에도 할당량 제한 유지. |
| `request_log` | 요청별 로그(ID, 별칭, 프로바이더, 모델, 상태, 토큰 수, 장애 조치 여부, 소요 시간). 14일간 보관 후 시작 시 정리. |

- 토큰 수: 업스트림에서 보고한 실제 값을 우선 기록하고, 없으면 안전한 추정치(입력 = 글자수÷4, 출력 = 스트림 글자수÷4)를 기록. `source` 컬럼에 `real` / `estimated` / `mixed`로 구분.
- `data/` 디렉터리는 권한 `0700`, DB 파일은 `0600`으로 생성됩니다. 사용량 카운터를 초기화하려면 `data/prismd.sqlite`를 삭제하거나 Web UI / CLI에서 리셋을 실행하십시오.

## 헬스 체크

패시브 방식만 지원합니다(소중한 무료 할당량을 낭비하는 능동적 프로브는 수행하지 않음). 메모리 내에서 `(provider, model)` 단위로 관리됩니다:

```
healthy → (3회 연속 실패) → cooldown 60초 → half-open (단일 프로브 시도)
              ↑                                   성공 → healthy
              └─────────────────────────── 실패 → 다시 cooldown
```

- 401/403 인증 오류는 `lastError`에 별도 기록되어 로그에서 명확히 확인 가능.
- 임계값은 `policies.failThreshold` / `policies.cooldownMs`로 조정 가능.

## 정책 구성 참조

`config.user.json`의 `policies`에서 재정의 가능한 필드 목록(기본값):

| 필드 | 기본값 | 의미 |
| --- | --- | --- |
| `failoverOn` | `["401","403","429","500","502","503","504"]` | 장애 조치를 트리거하는 업스트림 상태 코드 |
| `retryBeforeStream` | `true` | 스트림 시작 전 다른 후보 재시도 |
| `retryAfterStream` | `false` | 스트림 시작 후 재시도 금지 |
| `maxCandidatesPerRequest` | `2` | 요청당 시도할 최대 후보 수 |
| `respectRetryAfter` | `true` | 쿨다운 계산 시 업스트림 `Retry-After` 준수 |
| `quotaSoftLimitRatio` | `0.8` | 소프트 강등을 트리거하는 일일 할당량 비율 |
| `connectTimeoutMs` | `10000` | 스트림 시작 전 연결 타임아웃(ms) |
| `streamIdleTimeoutMs` | `300000` | 스트림 청크 간 최대 유휴 허용 시간(ms) |
| `failThreshold` | `3` | 쿨다운으로 진입하는 연속 실패 횟수 |
| `cooldownMs` | `60000` | 쿨다운 지속 시간(ms) |

## Codex 연동

1. 예제 프로필을 복사하고 카탈로그를 생성합니다:

```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # → ~/.codex/prismd-models.json
```

2. 실행:

```bash
PRISMD_API_KEY=<local-token> codex --profile prismd
```

- 프로필의 `model`은 게이트웨이 별칭 `free-auto`로 지정됩니다. `model_catalog_json`은 각 별칭에 속한 후보 모델들의 **최소** 컨텍스트 크기를 설정하여 오버플로우를 방지합니다.
- Codex의 재시도 설정을 낮게 유지하십시오: `request_max_retries = 0`(장애 조치는 게이트웨이에 위임), `stream_max_retries = 1`(스트림 재연결용).

## 기타 클라이언트 연동 (Claude Code, OpenCode, dsh, Pi)

모든 클라이언트가 동일한 별칭(`free-auto`, `free-fast`, `free-code`)과 로컬 보호 토큰을 공유합니다:

- **Claude Code** — Anthropic Messages 프로토콜: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, `ANTHROPIC_AUTH_TOKEN`(또는 `x-api-key`)에 prismd 토큰 설정. Claude 모델명(`claude-...-sonnet-...` 등)은 자동으로 구성된 별칭으로 변환됩니다. 자세한 내용은 `examples/claude-code/`를 참조하세요.
- **OpenCode / dsh / Pi** — OpenAI 호환: 프로바이더의 `baseURL`을 `http://127.0.0.1:8787/v1`로, API 키를 prismd 토큰으로 설정. `responses` 및 `chat` 프로토콜을 모두 지원합니다. 자세한 내용은 `examples/opencode/`, `examples/dsh/`, `examples/pi/`를 참조하세요.

## 상태 모니터링, Web UI 및 서비스 탐색

- **Web UI 대시보드 (`GET /ui`)**:
  브라우저에서 `http://127.0.0.1:8787/ui`를 엽니다. 실시간 상태 배지(🟢 healthy, 🟡 rate_limited/cooldown, 🔴 unavailable), 일일 요청 진행률 표시줄, 토큰 수, 컨텍스트 창 크기, 활성 모델 및 실시간 이벤트 로그를 표시합니다. 7개 언어(English, 简体中文, 日本語, 한국어, Deutsch, Français, Español) 전환을 지원합니다.

- **CLI 상태 명령어 (`prismd status` / `npm run status`)**:
  터미널에서 직접 상태를 확인:
  ```bash
  prismd status          # 전역 설치 시
  npm run status         # 소스 저장소 환경에서
  ```
  게이트웨이가 실행 중이면 ANSI 컬러 테이블로 표시하고, 오프라인이면 SQLite에서 오늘의 기록을 자동 표시합니다. 시스템 언어 환경 변수(`LANG`)에 따라 자동 현지화됩니다.

- **JSON 상태 API (`GET /v1/modelstatus`)**:
  모든 별칭, 후보 모델, 헬스 상태, 쿨다운 타이머, 토큰 사용량에 대한 메모리 내 스냅샷을 반환합니다(인증 불필요).

- **SSE 실시간 스트림 (`GET /v1/modelstatus/stream`)**:
  Server-Sent Events를 통해 실시간 상태 업데이트를 수신합니다(인증 불필요).

- **헬스 체크 (`GET /healthz`)**:
  `{ "status": "ok", "uptime": ..., "candidates": [...] }` 반환(인증 불필요).

- **모델 탐색 (`GET /v1/models`)**:
  구성된 별칭 목록을 OpenAI 호환 형식 `{ "object": "list", "data": [...] }`으로 반환(인증 불필요).

## 관측 가능성 (Observability)

- **구조화된 로그**: stderr에 1라인 1이벤트 형식의 JSON pino 로그 출력.
- **요청 ID**: 모든 요청에 UUID를 할당하여 로그 및 응답 헤더(`x-request-id`)로 전 구간 추적 가능.
- **요청 요약**: 요청 종료 시 `request_end` 로그 한 줄 출력(메소드, 경로, 별칭, 선택된 후보, 상태, 첫 토큰 지연 시간, 총 소요 시간, 사용량).
- **보안 마스킹**: `authorization` / `api-key` / `token` 등의 민감한 값은 자동으로 `****` 마스킹 처리.

## 디렉터리 구조

- `prismd.json` — 실행 시 사용하는 단일 설정 파일(자동 생성, Git 미포함). 시작 시 1회 로드.
- `presets/providers.json` — 기본 프로바이더 및 무료 모델 메타데이터 정의와 기본 별칭.
- `config.user.json` — 사용자 정의 상위 설정 파일.
- `config.schema.json` — `prismd.json` 유효성을 검증하는 JSON Schema (draft-07).
- `scripts/generate-config.mjs` — 각 설정을 병합하여 `prismd.json`을 생성하는 스크립트.
- `scripts/generate-codex-catalog.mjs` — `~/.codex/prismd-models.json` 카탈로그 생성 스크립트.
- `examples/` — 각 클라이언트별 설정 예제 디렉터리(`codex/`, `claude-code/`, `opencode/`, `dsh/`, `pi/`).
- `src/ingress/` — 클라이언트 프로토콜 진입점(`responses.ts`, `chat.ts`, `messages.ts`).
- `src/egress/` — 업스트림 프로토콜 어댑터(`responses.ts`, `chat.ts`, `chat-converter.ts`, `raw.ts`).
- `src/routes/` — 인증 불필요 상태 및 탐색 라우트(`/healthz`, `/v1/models`, `/v1/modelstatus`, `/ui`).
- `src/ui/` — 내장 단일 파일 Web UI 상태 페이지(HTML/CSS/JS).
- `src/cli/` — CLI 명령어 구현체(`prismd status`).
- `src/providers/` — 프로바이더별 전용 요청 빌더.
- `src/core/` — 별칭 라우팅, 상태 머신, 이벤트 브로드캐스터, 할당량 계산, SQLite 상태 저장소.
- `src/observability/` — pino 구조화 로깅, 요청 ID, 익스포터 인터페이스.
- `src/keys.ts` — 키 확인 및 로드 모듈.
- `src/auth.ts` — 로컬 보호 토큰 유효성 검사.

## 유용한 스크립트 명령어

- `npm run dev` — tsx watch 기반 개발 모드 실행
- `npm run build` / `npm start` — TypeScript 빌드 및 프로덕션 실행
- `npm run typecheck` — `tsc --noEmit` 타입 검사 실행
- `npm test` — 단위 및 통합 테스트 실행
- `npm run test:e2e` — 모의 업스트림 대상 E2E 승인 테스트 실행
- `npm run status` — 실시간 후보 모델 상태 및 할당량 테이블 출력
- `npm run generate:config` — `prismd.json` 설정 재생성
- `npm run generate:codex-catalog` — `~/.codex/prismd-models.json` 카탈로그 재생성
