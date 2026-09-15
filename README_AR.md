# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

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

### الخطوة 1: التثبيت

```bash
# الخيار أ: التثبيت العام عبر npm
npm install -g @prismd/prismd              # الإصدار المستقر
# أو تثبيت إصدار المعاينة RC (متوافق مع أحدث develop):
npm install -g @agentscraft/prismd         # قناة RC

# الخيار ب: التشغيل من المصدر
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

### الخطوة 2: التهيئة والتشغيل

شغّل معالج الإعداد التفاعلي لتكوين مفاتيحك وعملائك:
```bash
prismd init
# Source install: node dist/server.js init
```
سيرشدك المعالج إلى:
1. تعيين رمز الحماية المحلي (`prismd:`).
2. اختيار مزودي النماذج المجانية (OpenRouter وGroq وGoogle Gemini وغيرها) وإدخال المفاتيح.
3. **التكوين التلقائي لعملاء البرمجة** (Claude Code وCodex CLI وOpenCode وPi Agent) مع إنشاء نسخ احتياطية مؤرخة تلقائيًا (`.bak.<الوقت>`)!

*(هل تفضل التكوين اليدوي؟ يمكنك تعديل `~/.prismd/keys.yaml` يدويًا أو تعيين `PRISMD_HOME`).*

```yaml
# مثال الإعداد اليدوي: ~/.prismd/keys.yaml (الأذونات الموصى بها: chmod 600)
prismd: "YOUR_PRISMD_TOKEN"       # رمز الحماية المحلي (يستخدمه العملاء)

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
# Global install:
prismd
# Source install: node dist/server.js
```

> 📖 **أدلة إعداد المزودين**: راجع [أدلة تكامل مزودي النماذج](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) لمعرفة خطوات الحصول على المفاتيح وقوائم النماذج.

### الخطوة 3: إعداد الوكيل الخاص بك

| العميل | البدء السريع (تهيئة تلقائية عبر `prismd init`) | الدليل |
|---|---|---|
| **Claude Code** | `claude` (مُهيأ في `~/.claude/settings.json`) | [الدليل](examples/claude-code/README.md) |
| **Codex CLI** | `codex` (مُهيأ في `~/.codex/config.toml` و `auth.json`) | [الدليل](examples/codex/README.md) |
| **OpenCode** | `opencode` (مُهيأ في `~/.config/opencode/opencode.json`) | [الدليل](examples/opencode/README.md) |
| **Pi Agent** | `pi` (مُهيأ في `~/.pi/config.json`) | [الدليل](examples/pi/README.md) |
| **Cursor** | Settings → Models → تفعيل OpenAI API Key (`YOUR_PRISMD_TOKEN`)<br>تحديد **Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>إضافة النموذج: `free-auto` | [الدليل](examples/cursor/README.md) |
| **DeepSeek Harness (dsh)** | اضبط `base_url = "http://127.0.0.1:8787/v1"` في `~/.dsh/config.toml`<br>`PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [الدليل](examples/dsh/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="YOUR_PRISMD_TOKEN"` `aider --model openai/free-auto` | [الدليل](examples/aider/README.md) |

> 📖 **التوثيق الكامل**: راجع [فهرس الوثائق](docs/README.md) و[دليل تكامل العملاء](docs/clients/README.md) و[دليل الإعداد](docs/configuration.md).

---
