# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

Ücretsiz ve düşük maliyetli model API'lerini (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models vb.) ve yerel LLM'leri (Ollama) bir araya getiren **yerel öncelikli, yüksek erişilebilirlikli LLM ağ geçidi**. Kodlama ajanları (Claude Code, Codex CLI, Cursor, OpenCode, Aider vb.) için kesintisiz, kararlı ve otomatik yük devretmeli birleşik bir arayüz sağlar.

```mermaid
flowchart LR
    subgraph Clients["Kodlama Ajanları (Clients)"]
        CC["Claude Code<br/>(Anthropic Messages)"]
        CX["Codex CLI<br/>(OpenAI Responses)"]
        CU["Cursor / OpenCode<br/>(Chat Completions)"]
    end

    subgraph Gateway["prismd (127.0.0.1:8787)"]
        Router["Akıllı Yönlendirici (free-auto)<br/>Kota Ağırlıklandırması / Bağlam Kontrolü / 429 Yük Devretme"]
        KeyPool["Çoklu Anahtar Havuzu (Key Pool)<br/>Tekil Anahtar Devre Kesici / Round-Robin"]
    end

    subgraph Upstreams["Sağlayıcılar (Providers)"]
        Cloud["Bulut Ücretsiz API'leri<br/>OpenRouter / Groq / Cerebras / Gemini..."]
        Local["Yerel Çevrimdışı Yedek<br/>Ollama (qwen2.5-coder / deepseek-r1)"]
    end

    Clients --> Gateway
    Gateway --> Cloud
    Cloud -. "Tümü 429 / Çevrimdışı" .-> Local
```

---

## Öne Çıkan Özellikler

1. **Birleşik Model Takma Adı (`free-auto`)**: Model seçme derdine son; prismd mevcut en uygun ücretsiz modeli otomatik olarak seçer.
2. **Çoklu Anahtar Havuzu ve Arıza İzolasyonu (Key Pool)**: İstek hızı (RPM) sınırlarını aşın. Round-robin dağıtımı için birden fazla anahtar tanımlayın. Bir anahtar 429 hatası aldığında yalnızca o anahtar beklemeye alınır ve trafik hemen diğer anahtara aktarılır.
3. **Yerel Ollama Sıfır Kesintili Çevrimdışı Yedek**: Bulut kotaları bittiğinde veya internet kesildiğinde, istekler şeffaf bir şekilde yerel Ollama'ya (`qwen2.5-coder:7b`, `deepseek-r1:8b`) devredilir.
4. **Çift Yönlü Protokol Dönüşümü**: Claude Code (Messages), Codex (Responses) ve Cursor/OpenCode (Chat Completions) arasında tam şeffaf çift yönlü akış desteği.
5. **Gömülü Web Paneli ve SIGHUP ile Çalışırken Yenileme**: `http://127.0.0.1:8787/ui` adresinden anlık durumu takip edin; `SIGHUP` sinyaliyle yapılandırmaları kesintisiz güncelleyin.

---

## Projeyi Destekleyin

prismd size zaman veya kota tasarrufu sağladıysa, geliştiriciye bir kahve ısmarlayabilirsiniz:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## 3 Adımda Hızlı Başlangıç

### 1. Adım: Kurulum ve Başlatma

```bash
# Seçenek A: Global npm kurulumu (Önerilen)
npm install -g @prismd/prismd

# Seçenek B: Kaynak koddan çalıştırma
git clone https://github.com/AgentsCraft/prismd.git
cd prismd && npm install
```

### 2. Adım: API Anahtarlarını Yapılandırma

Anahtarlarınızı `~/.prismd/keys.yaml` veya `./.env` dosyasına ekleyin:

```yaml
# ~/.prismd/keys.yaml (önerilen izin: chmod 600)
prismd: "yerel-gizli-token"     # Yerel koruma belirteci

# Tekli veya çoklu anahtar havuzu:
openrouter: "sk-or-v1-xxxx"
groq:
  - "gsk_key1_xxxx"             # Çoklu anahtar round-robin
  - "gsk_key2_xxxx"
cerebras: ["csk_1_xxxx", "csk_2_xxxx"]
gemini: "AIzaSyxxxx"
```

Ağ geçidini başlatın:
```bash
prismd
# Veya kaynak modunda: npm run generate:config && npm run dev
```

### 3. Adım: Ajanınızı Yapılandırın

| İstemci | Hızlı Kurulum |
|---|---|
| **Claude Code** | `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"`<br>`export ANTHROPIC_API_KEY="yerel-gizli-token"`<br>`claude` |
| **Codex CLI** | `PRISMD_API_KEY=yerel-gizli-token codex --profile prismd` ([Codex Kılavuzu](examples/codex/README.md)) |
| **Cursor** | Settings → Models → OpenAI API Key etkinleştirin (`yerel-gizli-token`)<br>**Override OpenAI Base URL** işaretleyin: `http://127.0.0.1:8787/v1`<br>Model ekleyin: `free-auto` |
| **OpenCode** | `~/.config/opencode/config.json` dosyasında `baseUrl: "http://127.0.0.1:8787/v1"` ayarlayın ([OpenCode Kılavuzu](examples/opencode/README.md)) |

---

## Detaylı Özellikler

### 1. Varsayılan Takma Adlar

- **`free-auto`**: Genel kodlama modeli. Gemini 2.0 Flash / Llama 3.3 70b önceliklidir; bulut kullanılamadığında yerel Ollama `qwen2.5-coder:7b` modeline otomatik düşer.
- **`free-fast`**: Ultra hızlı ve hafif model kuyruğu (Gemini Flash Lite / Llama 3.1 8b).
- **`free-code`**: Kod üretimi için özelleşmiş model kuyruğu.

### 2. Çoklu Anahtar ve Hata İzolasyonu

`.env` veya `keys.yaml` dosyasında birden fazla anahtar tanımlayın:
- **`.env`**: `GROQ_API_KEY="gsk_key1,gsk_key2,gsk_key3"`
- **`keys.yaml`**:
  ```yaml
  groq:
    - "gsk_key1"
    - "gsk_key2"
  ```
- **Çalışma Mantığı**: İstekler round-robin ile dağıtılır. `gsk_key1` 429 hatası aldığında yalnızca o anahtar bekletmeye alınır (`Retry-After`), sonraki istekler hemen `gsk_key2` anahtarına yönlendirilir.

### 3. Yerel Ollama Çevrimdışı Yedek

- Yerleşik `ollama` sağlayıcısı (`http://127.0.0.1:11434/v1`, anahtar gerekmez).
- Yerelde Ollama çalıştırıldığında:
  ```bash
  ollama run qwen2.5-coder:7b
  ```
- Bulut kotaları tükendiğinde veya bağlantı kesildiğinde prismd istekleri otomatik olarak yerel modele yönlendirir.

### 4. Dinamik Çalışırken Yenileme (SIGHUP)

Bağlantıları kesmeden yapılandırmayı güncelleyin:
```bash
kill -HUP $(pgrep -f "prismd")
```

---

## İzleme ve Web Paneli

- **Web Paneli**: Tarayıcınızda `http://127.0.0.1:8787/ui` adresini açın:
  - Gerçek zamanlı model durumu (`healthy` / `rate_limited` / `cooldown`)
  - Günlük kota ilerleme çubukları ve token istatistikleri
  - 10 dil seçeneği ve «Kullanımı Sıfırla (Reset usage)» düğmesi
- **CLI Durumu**:
  ```bash
  prismd status
  ```
  Terminalde renkli durum matrisi.

---

## Sorun Giderme

- **Q: `missing API key for provider` hatası alıyorum?**
  - `~/.prismd/keys.yaml` veya `.env` dosyanızı kontrol edin ve `npm run generate:config` komutunu çalıştırın.
- **Q: Ücretsiz modellerde sık sık 429 hatası çıkıyor?**
  - İlgili sağlayıcı için birden fazla anahtar ekleyin veya `ollama run qwen2.5-coder:7b` başlatın.
- **Q: Günlük kota sayaçları nasıl sıfırlanır?**
  - Web panelinden «Reset usage» butonuna tıklayın veya `data/prismd.sqlite` dosyasını silin.
