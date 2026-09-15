# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

[![npm version](https://img.shields.io/npm/v/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![npm downloads](https://img.shields.io/npm/dt/@prismd/prismd?logo=npm)](https://www.npmjs.com/package/@prismd/prismd)
[![License](https://img.shields.io/npm/l/@prismd/prismd)](https://github.com/AgentsCraft/prismd/blob/main/LICENSE)

Ücretsiz ve düşük maliyetli model API'lerini (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models vb.) ve yerel LLM'leri (Ollama) bir araya getiren **yerel öncelikli, yüksek erişilebilirlikli LLM ağ geçidi**. Kodlama ajanları (Claude Code, Codex CLI, Cursor, OpenCode, Aider vb.) için kesintisiz, kararlı ve otomatik yük devretmeli birleşik bir arayüz sağlar.

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

## Öne Çıkan Özellikler

1. **Birleşik Model Takma Adı (`free-auto`)**: Model seçme derdine son; prismd mevcut en uygun ücretsiz modeli otomatik olarak seçer.
2. **Çoklu Anahtar Havuzu ve Arıza İzolasyonu (Key Pool)**: İstek hızı (RPM) sınırlarını aşın. Round-robin dağıtımı için birden fazla anahtar tanımlayın. Bir anahtar 429 hatası aldığında yalnızca o anahtar beklemeye alınır ve trafik hemen diğer anahtara aktarılır.
3. **İsteğe Bağlı Yerel Yedek (Ollama / LM Studio)**: Varsayılan takma adlar yalnızca bulut modeli içerir. Yerel bir backend mi çalıştırıyorsunuz? `config.user.json` ile bir kuyruğa ekleyin — bulut modelleri tükendiğinde veya internet kesildiğinde istekler yerel modellerinize düşer.
4. **Çift Yönlü Protokol Dönüşümü**: Claude Code (Messages), Codex (Responses) ve Cursor/OpenCode (Chat Completions) arasında tam şeffaf çift yönlü akış desteği.
5. **Gömülü Web Paneli ve SIGHUP ile Çalışırken Yenileme**: `http://127.0.0.1:8787/ui` adresinden anlık durumu takip edin; `SIGHUP` sinyaliyle yapılandırmaları kesintisiz güncelleyin.

---

## Projeyi Destekleyin

prismd size zaman veya kota tasarrufu sağladıysa, geliştiriciye bir kahve ısmarlayabilirsiniz:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3 Adımda Hızlı Başlangıç

### 1. Adım: Kurulum

```bash
# Seçenek A: Global npm kurulumu
npm install -g @prismd/prismd              # Kararlı sürüm (Stable)
# Veya RC önizleme kanalını kurun (en güncel develop ile uyumlu):
npm install -g @agentscraft/prismd         # RC kanalı

# Seçenek B: Kaynak koddan çalıştırma
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
npm run build
```

### 2. Adım: Başlatma

Etkileşimli kurulum sihirbazını çalıştırın:
```bash
prismd init
# Source install: node dist/server.js init
```
Sihirbaz şunları sağlar:
1. Yerel koruma belirtecini (`prismd:`) belirleyin.
2. Ücretsiz sağlayıcıları seçin (OpenRouter, Groq, Google Gemini vb.) ve API anahtarlarını girin.
3. **Kodlama istemcilerini otomatik yapılandırın** (Claude Code, Codex CLI, OpenCode, Pi Agent) ve mevcut dosyaların güvenli zaman damgalı yedeklerini (`.bak.<zaman_damgası>`) alın!

*(Manuel yapılandırmayı mı tercih ediyorsunuz? `~/.prismd/keys.yaml` dosyasını düzenleyin veya `PRISMD_HOME` kullanın).*

```yaml
# Manuel yapılandırma örneği: ~/.prismd/keys.yaml (önerilen izin: chmod 600)
prismd: "YOUR_PRISMD_TOKEN"     # Yerel koruma belirteci (istemciler tarafından kullanılır)

# Bulut Sağlayıcıları (round-robin için tek anahtar veya çoklu anahtar havuzunu destekler):
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # Çoklu anahtar havuzu ve soğutma izolasyonu
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
nvidia: "nvapi-xxxx"
github: "ghp_xxxx"              # GitHub Models kişisel erişim belirteci
amd: "amd_token_xxxx"           # İsteğe bağlı: AMD Developer Cloud belirteci

# Yerel Çevrimdışı Yedek:
# ollama: Anahtar gerekmez (http://127.0.0.1:11434/v1 adresine otomatik yönlendirilir)
```

Ağ geçidini başlatın:
```bash
# Global install:
prismd
# Source install: node dist/server.js
```

> 📖 **Sağlayıcı Yapılandırma Kılavuzları**: Anahtar alma ve model listesi detayları için [Model Sağlayıcı Entegrasyon Kılavuzu](docs/providers/README.md) ([OpenRouter](docs/providers/openrouter.md), [Groq](docs/providers/groq.md), [Cerebras](docs/providers/cerebras.md), [Google Gemini](docs/providers/gemini.md), [NVIDIA NIM](docs/providers/nvidia.md), [GitHub Models](docs/providers/github-models.md), [AMD](docs/providers/amd.md), [Ollama](docs/providers/ollama.md), [LM Studio](docs/providers/lmstudio.md)) sayfasına bakın.

### 3. Adım: Ajanınızı Yapılandırın

| İstemci | Hızlı Başlangıç (`prismd init` otomatik yapılandırma) | Kılavuz |
|---|---|---|
| **Claude Code** | `claude` (`~/.claude/settings.json` içinde yapılandırıldı) | [Kılavuz](examples/claude-code/README.md) |
| **Codex CLI** | `codex` (`~/.codex/config.toml` ve `auth.json` içinde yapılandırıldı) | [Kılavuz](examples/codex/README.md) |
| **OpenCode** | `opencode` (`~/.config/opencode/opencode.json` içinde yapılandırıldı) | [Kılavuz](examples/opencode/README.md) |
| **Pi Agent** | `pi` (`~/.pi/config.json` içinde yapılandırıldı) | [Kılavuz](examples/pi/README.md) |
| **Cursor** | Settings → Models → OpenAI API Key etkinleştirin (`YOUR_PRISMD_TOKEN`)<br>**Override OpenAI Base URL**: `http://127.0.0.1:8787/v1`<br>Model ekleyin: `free-auto` | [Kılavuz](examples/cursor/README.md) |
| **DeepSeek Harness (dsh)** | `~/.dsh/config.toml` dosyasında `base_url = "http://127.0.0.1:8787/v1"` ayarlayın<br>`PRISMD_API_KEY=YOUR_PRISMD_TOKEN dsh --model prismd:free-auto` | [Kılavuz](examples/dsh/README.md) |
| **Aider** | `OPENAI_API_BASE="http://127.0.0.1:8787/v1"` `OPENAI_API_KEY="YOUR_PRISMD_TOKEN"` `aider --model openai/free-auto` | [Kılavuz](examples/aider/README.md) |

> 📖 **Tam Belgeler**: [Dokümantasyon dizini](docs/README.md), [istemci entegrasyon kılavuzu](docs/clients/README.md) ve [yapılandırma kılavuzu](docs/configuration.md) sayfalarına bakın.

---
