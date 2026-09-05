# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

**بوابة LLM محلية عالية التوافر** تجمع بين واجهات برمجة التطبيقات المجانية والمنخفضة التكلفة (OpenRouter و Groq و Cerebras و Google Gemini و NVIDIA NIM و GitHub Models وغيرها) ونماذج LLM المحلية (Ollama). توفر واجهة موحدة ومستقرة وغير منقطعة لوكلاء البرمجة (Claude Code و Codex CLI و Cursor و OpenCode و Aider وغيرها).

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

## الميزات الرئيسية

1. **اسم مستعار موحد للنماذج (`free-auto`)**: لا حاجة لاختيار النماذج يدويًا؛ يختار prismd تلقائيًا أفضل نموذج مجاني متاح.
2. **مجمع المفاتيح المتعددة وعزل الأعطال (Key Pool)**: تجاوز قيود معدل الطلبات (RPM). قم بتعيين مفاتيح متعددة لتوزيع الحمل بالتناوب (Round-Robin). عند حدوث خطأ 429 على مفتاح معين، يتم تبريد هذا المفتاح فقط وتتحول الطلبات فورًا إلى المفتاح التالي.
3. **احتياطي محلي اختياري (Ollama / LM Studio)**: الأسماء المستعارة الافتراضية سحابية فقط. هل تشغّل محرك استدلال محليًا؟ أضفه إلى قائمة أحد الأسماء عبر `config.user.json` — عند نفاد نماذج السحابة أو انقطاع الشبكة، تتحول الطلبات إلى نماذجك المحلية.
4. **تحويل ثنائي الاتجاه عبر البروتوكولات**: دعم أصيل للتدفق المتبادل بين Claude Code (Messages) و Codex (Responses) و Cursor/OpenCode (Chat Completions).
5. **لوحة تحكم ويب مدمجة وإعادة تحميل ديناميكية (SIGHUP)**: راقب الحالة مباشرة عبر `http://127.0.0.1:8787/ui`، وقم بتحديث الإعدادات دون إعادة التشغيل عبر إشارة `SIGHUP`.

---

## دعم المشروع

إذا وفر لك prismd الوقت أو تكاليف الحصص، يمكنك دعم المطور بفنجان قهوة:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## البدء السريع في 3 خطوات

### الخطوة 1: التثبيت والتشغيل

```bash
# الخيار أ: التثبيت العام عبر npm
npm install -g @prismd/prismd              # الإصدار المستقر
# أو تثبيت إصدار المعاينة RC (متوافق مع أحدث develop):
npm install -g @agentscraft/prismd         # قناة RC

# الخيار ب: التشغيل من المصدر
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### الخطوة 2: تكوين مفاتيح API

أضف مفاتيحك في `~/.prismd/keys.yaml` أو في ملف `./.env` (يمكنك تكوين مزود واحد أو أكثر؛ يتم تجاوز المزودين غير المحددين تلقائيًا):

```yaml
# ~/.prismd/keys.yaml (الأذونات الموصى بها: chmod 600)
prismd: "my-local-secret"       # رمز الحماية المحلي (يستخدمه العملاء)

# مزودو الخدمات السحابية (يدعم المفتاح المفرد أو مجمع المفاتيح المتعددة للتوزيع بالتناوب):
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # مجمع مفاتيح متعددة وعزل فترة التبريد
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # رمز الوصول الشخصي لنماذج GitHub Models
amd: "amd_token_xxxx"           # اختياري: رمز AMD Developer Cloud

# التراجع المحلي دون اتصال:
# ollama: لا يتطلب مفاتيح (توجيه تلقائي إلى http://127.0.0.1:11434/v1)
```

تشغيل البوابة:
```bash
prismd
# أو من المصدر: npm run generate:config && npm run dev
```

> 📖 **أدلة إعداد المزودين**: راجع [أدلة تكامل مزودي النماذج](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) لمعرفة خطوات الحصول على المفاتيح وقوائم النماذج.

### الخطوة 3: إعداد الوكيل الخاص بك

| العميل | الإعداد السريع | الدليل |
|---|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="my-local-secret"`<br>`claude` | [الدليل](examples/claude-code/README.md) |
| **Codex CLI** | `PRISMD_API_KEY=my-local-secret codex --profile prismd` | [الدليل](examples/codex/README.md) |
| **Cursor** | Settings → Models → تفعيل OpenAI API Key (`my-local-secret`)<br>تحديد **Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>إضافة النموذج: `free-auto` | [الدليل](examples/cursor/README.md) |
| **OpenCode** | اضبط `baseUrl: "http://127.0.0.1:8787/v1"` في `~/.config/opencode/config.json` | [الدليل](examples/opencode/README.md) |
| **DeepSeek Harness (dsh)** | اضبط `base_url = "http://127.0.0.1:8787/v1"` في `~/.dsh/config.toml`<br>`PRISMD_API_KEY=my-local-secret dsh --model prismd:free-auto` | [الدليل](examples/dsh/README.md) |
| **Pi Agent** | اضبط `endpoint: "http://127.0.0.1:8787/v1"` في `~/.pi/config.json`<br>`pi run` | [الدليل](examples/pi/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="my-local-secret"` `aider --model openai/free-auto` | [الدليل](examples/aider/README.md) |

> 📖 **التوثيق الكامل**: راجع [دليل تكامل العملاء](docs/clients/README.md) للحصول على تفاصيل البروتوكولات والإعدادات المتقدمة.

---

## تفاصيل الميزات

### 1. التوجيه الذكي وتجاوز الفشل التلقائي

يحدد prismd ديناميكيًا النموذج المرشح الأمثل لكل طلب من خلال مسار تقييم متعدد الأبعاد:

- **التحقق من نافذة السياق (Context Window Check)**: تقدير الرموز المدخلة مسبقًا؛ واستبعاد النماذج ذات النوافذ غير الكافية لمنع أخطاء 400 Context Overflow.
- **تخفيض الأولوية للحصص المرنة (Quota-Weighted Soft Limit)**: عند وصول النموذج إلى 80% من حصته اليومية (`quotaSoftLimitRatio`)، يتم نقله تلقائيًا إلى نهاية الطابور لحفظ الرصيد المتبقي.
- **تجاوز الفشل دون انقطاع (Zero-Crash Failover)**: في حال إرجاع خطأ 429 أو 5xx من المزود، يتحول prismd فورًا وبشفافية إلى النموذج التالي في الطابور.
- **الأسماء المستعارة الافتراضية**:
  - `free-auto`: طابور البرمجة الأساسي (أولوية Gemini 2.0 Flash / Llama 3.3 70B، وقائمة سحابية افتراضيًا).

### 2. مجمع المفاتيح المتعددة وعزل الأعطال (Key Pool)

تدعم جميع المزودين السحابيين (Groq و Cerebras و Google Gemini و OpenRouter و NVIDIA NIM و GitHub Models وغيرها) تكوين مفاتيح متعددة للتوزيع التلقائي بالتناوب وعزل الأعطال:

- **تنسيق `~/.prismd/keys.yaml`** (قائمة أو مصفوفة مدمجة):
  ```yaml
  groq:
    - "gsk_key1_xxxx"
    - "gsk_key2_xxxx"
  cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
  gemini:
    - "AIzaSy_key1_xxxx"
    - "AIzaSy_key2_xxxx"
  ```
- **تنسيق `.env` أو متغيرات البيئة** (مفصولة بفواصل):
  ```bash
  GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"
  GEMINI_API_KEY="AIzaSy1,AIzaSy2"
  ```
- **آلية العمل**: يتم توزيع الطلبات عبر مفاتيح صالحة باستخدام Round-Robin. عندما يتلقى مفتاح معين (مثل `gsk_key1`) خطأ 429، يدخل ذلك المفتاح فقط في فترة التهدئة (`Retry-After`)، بينما تتحول الطلبات اللاحقة فورًا إلى المفتاح التالي (`gsk_key2`) أو النموذج البديل.

### 3. احتياطي محلي اختياري (Ollama & LM Studio)

prismd يتضمن Ollama و LM Studio كمزودين مدمجين، لكن الأسماء الافتراضية سحابية فقط. تعمل خدمة محلية؟ أضفها كمرشح عبر `config.user.json`:

- **Ollama**: مزود مدمج دون الحاجة إلى تكوين (`http://127.0.0.1:11434/v1`):
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- **LM Studio**: خادم محلي متوافق مع OpenAI (`http://127.0.0.1:1234/v1`) يشغل نماذج GGUF. راجع [دليل إعداد LM Studio](docs/providers/lmstudio.md).
- تستمر مهام الوكلاء بأمان دون أي انهيار.

### 4. جسر شفاف متعدد البروتوكولات

تحويل ثنائي الاتجاه بالتدفق المباشر بين البروتوكولات الثلاثة الرئيسية:
- **Anthropic Messages** (`POST /v1/messages`): دعم كامل لـ Claude Code (الأدوات Tools، كتل التفكير Thinking، وتدفق SSE).
- **OpenAI Responses** (`POST /v1/responses`): متوافق مع Codex CLI و DeepSeek Harness (`dsh`).
- **OpenAI Chat Completions** (`POST /v1/chat/completions`): واجهة قياسية لـ Cursor و OpenCode و Pi Agent و Aider.

### 5. تكوين قابل للتوسيع (`config.user.json`)

قم بتعريف مزودين مخصصين، نماذج خاصة، أو طوابير أسماء مستعارة في `config.user.json`:

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
أعد توليد التكوين عبر `npm run generate:config`.

### 6. إعادة التحميل الساخن الديناميكي (`SIGHUP`)

تحديث جداول التوجيه والمفاتيح دون إعادة تشغيل العملية ودون قطع الاتصالات النشطة:
```bash
kill -HUP $(pgrep -f "prismd")
```

---

## المراقبة ولوحة تحكم الويب

- **لوحة تحكم الويب**: افتح `http://127.0.0.1:8787/ui` في المتصفح:
  - حالة صحة النماذج اللحظية (`healthy` / `rate_limited` / `cooldown`)
  - أشرطة تقدم الحصص اليومية وإحصائيات الرموز (Tokens)
  - محدد 10 لغات وزر «إعادة تعيين الاستخدام (Reset usage)»
- **حالة CLI**:
  ```bash
  prismd status
  ```
  يعرض مصفوفة ملونة في الطرفية.

---

## استكشاف الأخطاء وإصلاحها

- **س: خطأ `missing API key for provider`؟**
  - تحقق من المفاتيح في `~/.prismd/keys.yaml` أو `.env` ثم شغل `npm run generate:config`.
- **س: تكرار أخطاء 429 على النماذج المجانية؟**
  - أضف مفاتيح متعددة للمزود، أو أضف مرشح Ollama محليًا إلى قائمة الاسم عبر `config.user.json`.
- **س: كيفية إعادة تعيين عدادات الاستخدام اليومي؟**
  - انقر على «Reset usage» في لوحة تحكم الويب أو احذف `data/prismd.sqlite`.
