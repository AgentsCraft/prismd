# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

بوابة LLM محلية تُجمّع واجهات برمجة تطبيقات النماذج المجانية والمنخفضة التكلفة (OpenRouter و Groq و Cerebras وغيرها) لوكلاء البرمجة (Claude Code و Codex CLI و OpenCode وغيرها)، وتوفر واجهة موحدة ومستقرة مع التوجيه التلقائي وتجاوز الفشل.

باستخدام نقطة نهاية محلية واحدة واسم مستعار موحد (`free-auto`)، يتعامل prismd تلقائيًا مع:
- **التوجيه الذكي وحماية الحصص**: يختار تلقائيًا النماذج المرشحة المتاحة بناءً على نافذة السياق والاستخدام اليومي للحصة؛ ويخفض النماذج التي تصل إلى 80% أو أكثر إلى نهاية قائمة الانتظار.
- **تجاوز الفشل السلس**: قبل بدء التدفق، ينتقل تلقائيًا إلى المرشح التالي في حالة أخطاء 429/401/5xx أو انتهاء مهلة الشبكة.
- **تحويل متعدد البروتوكولات**: دعم أصلي لبروتوكولات OpenAI Responses و OpenAI Chat Completions و Anthropic Messages، مما يسمح لأي وكيل برمجة بالاتصال بسلاسة.

## الدعم

إذا وفر لك prismd الوقت أو الحصة، يمكنك دعم المؤلف بشراء فنجان قهوة:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## البدء السريع

### الخيار 1: التثبيت العام عبر npm (موصى به)

```bash
# تثبيت الإصدار المستقر
npm install -g @prismd/prismd

# أو قناة المعاينة RC
# npm install -g @agentscraft/prismd

# تكوين مفاتيح المزودين ورمز البوابة المحلي
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # رمز المصادقة المحلي، مثل openssl rand -hex 32

# تشغيل البوابة (تستمع على 127.0.0.1:8787)
prismd
```

### الخيار 2: التشغيل من الكود المصدري

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # أدخل مفاتيح API، مع chmod 600
npm run generate:config                    # دمج الإعدادات والمفاتيح لإنشاء prismd.json
npm run dev                                # بدء تشغيل خادم التطوير
```

### اختبار التحقق السريع

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## إعداد العملاء

تشير جميع وكلاء العملاء إلى نقطة نهاية البوابة المحلية وتستخدم نفس رمز الحماية المحلي (`PRISMD_API_KEY`).

### 1. Claude Code
يدعم Claude Code نقاط نهاية Anthropic المخصصة عبر متغيرات البيئة. تعود أسماء النماذج القياسية (`claude-*-sonnet` وغيرها) تلقائيًا إلى الأسماء المستعارة المكونة:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
انسخ الملف التعريفي النموذجي وأنشئ كتالوج بيانات التعريف:
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # إنشاء ~/.codex/prismd-models.json
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
قم بتكوين نقطة نهاية OpenAI مخصصة في Cursor:
- **Settings** ← **Models** ← قم بتمكين **OpenAI API Key** وأدخل `<your-prismd-local-token>`.
- فعّل خيار **Override OpenAI Base URL** وأدخل `http://127.0.0.1:8787/v1`.
- أضف وفعّل النماذج `free-auto` و `free-fast` و `free-code`. راجع [دليل إعداد Cursor](examples/cursor/README.md).

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**: عيّن `baseUrl: "http://127.0.0.1:8787/v1"` في `~/.config/opencode/config.json`. راجع [دليل OpenCode](examples/opencode/README.md).
- **DeepSeek Harness (dsh)**: عيّن `base_url = "http://127.0.0.1:8787/v1"` في `~/.dsh/config.toml`. راجع [دليل dsh](examples/dsh/README.md).
- **Pi Agent**: عيّن `endpoint: "http://127.0.0.1:8787/v1"` في `~/.pi/config.json`. راجع [دليل Pi](examples/pi/README.md).

---

## إدارة المفاتيح والتكوين

### إدارة المفاتيح
يمكن تكوين المفاتيح في ملف `.env` في جذر المشروع أو في الدليل العام `~/.prismd/`. ترتيب الأولوية (من الأعلى إلى الأدنى):
1. **متغيرات البيئة**: `OPENROUTER_API_KEY` و `GROQ_API_KEY` و `GEMINI_API_KEY` إلخ.
2. **دليل المشروع الحالي**: `./.env` (منسوخ من `.env.example`)
3. **دليل المستخدم العام**: `~/.prismd/.env` أو `~/.prismd/keys.yaml` (الصلاحية الموصى بها: `chmod 600`)

### تخصيص المرشحين والترتيب
قم بتجاوز أولويات المرشحين أو إضافة نماذج مخصصة في `config.user.json` ثم أعد إنشاء التكوين:
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
قم بتشغيل `npm run generate:config` (أو `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`) لتطبيق التغييرات.

للحصول على إرشادات تفصيلية حول موفري الخدمات المجانيين (OpenRouter و Groq و Cerebras و Google Gemini و NVIDIA NIM و GitHub Models وغيرها)، راجع [أدلة موفري الخدمات](docs/providers/README.md).

---

## الحالة وإمكانية الملاحظة

- **لوحة التحكم على الويب**: افتح `http://127.0.0.1:8787/ui` في متصفحك لمتابعة صحة النماذج وأشرطة تقدم الحصة اليومية واستخدام الرموز وأحداث SSE المباشرة.
- **حالة CLI**: شغّل `prismd status` (أو `npm run status`) لعرض جداول المقاييس الملونة مباشرة في الطرفية.
- **السجلات المهيكلة**: سجلات بتنسيق JSON تُرسل إلى stderr مع إخفاء المفاتيح الحساسة وتتبع بواسطة `request-id` فريد.

---

## آلية العمل والقيود

1. **التوجيه والتصفية**:
   - يجرّب المرشحين بالترتيب المكون؛
   - يستبعد تمامًا المرشحين المستنفدين أو ذوي السياق غير الكافي أو في فترة التهدئة؛
   - يخفض النماذج المستهلكة لـ 80% أو أكثر من الحصة إلى ذيل قائمة الانتظار.
2. **حدود تجاوز الفشل (Failover)**:
   - **قبل بدء التدفق**: عند أخطاء 401/403/429/5xx أو انتهاء المهلة، يحاول المرشح التالي حتى `maxCandidatesPerRequest`.
   - **بعد بدء التدفق**: لا يعيد المحاولة أثناء التدفق لتجنب تلف الاستجابات، وينهي العملية بحدث SSE `error`.
3. **قيود الحصص المجانية**:
   - تشارك النماذج العامة المجانية مجمعات سعة مشتركة وقد تُرجع أخطاء 429 في أوقات الذروة. يتجاوزها prismd تلقائيًا، وإذا استُنفدت جميع النماذج، يُرجع خطأ 429 مع التفاصيل في `error.metadata`.

---

## استكشاف الأخطاء وإصلاحها

- **تكرار أخطاء 429**: مجمعات النماذج المجانية مزدحمة. أعد ترتيب `free-auto` في `config.user.json` لمنح الأولوية للنماذج الأقل ازدحامًا أو أضف مفاتيح موفرين آخرين.
- **اختفاء النماذج بعد الترقية**: الإصدارات القديمة استخدمت تنسيقًا مختلفًا. شغّل `npm run generate:config` لتحديث `prismd.json`.
- **إعادة تعيين عدادات الحصة**: انقر على زر «Reset usage» في لوحة تحكم الويب (`http://127.0.0.1:8787/ui`)، أو أوقف البوابة واحذف `data/prismd.sqlite`.
