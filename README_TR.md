# prismd

[English](README.md) | [简体中文](README_CN.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Deutsch](README_DE.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Italiano](README_IT.md) | [العربية](README_AR.md) | [Türkçe](README_TR.md)

Kodlama aracıları (Claude Code, Codex CLI, OpenCode ve diğerleri) için ücretsiz ve düşük maliyetli model API'lerini (OpenRouter, Groq, Cerebras vb.) bir araya getiren, otomatik yönlendirme ve yük devretme özelliklerine sahip yerel öncelikli bir LLM ağ geçidi.

Tek bir yerel uç nokta ve birleşik bir takma ad (`free-auto`) ile prismd şunları otomatik olarak yönetir:
- **Akıllı Yönlendirme ve Kota Koruması**: Bağlam penceresine ve günlük kota kullanımına göre uygun aday modelleri otomatik seçer; kota kullanımı %80'e ulaşan adayları sıranın sonuna kaydırır.
- **Kesintisiz Yük Devretme (Failover)**: Akış başlamadan önce 429/401/5xx hatalarında veya ağ zaman aşımlarında otomatik olarak bir sonraki adaya geçer.
- **Çoklu Protokol Dönüşümü**: OpenAI Responses, OpenAI Chat Completions ve Anthropic Messages protokolleri için yerel destek sunarak her kodlama aracısının sorunsuzca bağlanmasını sağlar.

## Destek

prismd size zaman veya kota tasarrufu sağladıysa, geliştiriciye bir kahve ısmarlamayı düşünebilirsiniz:

[![ko-fi](https://storage.ko-fi.com/cdn/kofi2.png)](https://ko-fi.com/keanz21)

---

## Hızlı Başlangıç

### Seçenek 1: npm ile Genel Kurulum (Önerilen)

```bash
# Kararlı sürümü yükleyin
npm install -g @prismd/prismd

# Veya RC önizleme kanalı
# npm install -g @agentscraft/prismd

# Sağlayıcı anahtarlarını ve yerel ağ geçidi belirtecini ayarlayın
export OPENROUTER_API_KEY=<your-openrouter-key>
export PRISMD_API_KEY=<local-token>        # Yerel kimlik doğrulama belirteci, örn. openssl rand -hex 32

# Ağ geçidini başlatın (127.0.0.1:8787 üzerinde dinler)
prismd
```

### Seçenek 2: Kaynak Koddan Çalıştırma

```bash
git clone https://github.com/AgentsCraft/prismd.git
cd prismd
npm install
cp .env.example .env                       # API anahtarlarını girin, chmod 600
npm run generate:config                    # Ön ayarları ve anahtarları birleştirerek prismd.json oluşturun
npm run dev                                # Geliştirme sunucusunu başlatın
```

### Hızlı İşlevsellik Testi

```bash
curl -N http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $PRISMD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"free-auto","input":"say hi","stream":true}'
```

---

## İstemci Yapılandırması

Tüm istemci aracıları yerel ağ geçidi uç noktasına yönlendirilir ve aynı yerel koruma belirtecini (`PRISMD_API_KEY`) kullanır.

### 1. Claude Code
Claude Code, ortam değişkenleri aracılığıyla özel Anthropic uç noktalarını yerel olarak destekler. Standart model adları (`claude-*-sonnet` vb.) yapılandırılan ağ geçidi takma adlarına otomatik olarak çözümlenir:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_API_KEY="<your-prismd-local-token>"
claude
```

### 2. Codex CLI
Örnek profili kopyalayın ve model meta veri kataloğunu oluşturun:
```bash
cp examples/codex/prismd.config.toml ~/.codex/prismd.config.toml
npm run generate:codex-catalog    # ~/.codex/prismd-models.json dosyasını oluşturur
PRISMD_API_KEY=<your-prismd-local-token> codex --profile prismd
```

### 3. Cursor
Cursor'da özel bir OpenAI uç noktası yapılandırın:
- **Settings** → **Models** → **OpenAI API Key** özelliğini etkinleştirin, `<your-prismd-local-token>` girin.
- **Override OpenAI Base URL** seçeneğini işaretleyin, `http://127.0.0.1:8787/v1` girin.
- `free-auto`, `free-fast`, `free-code` modellerini ekleyin ve etkinleştirin. [Cursor Kılavuzu](examples/cursor/README.md)na bakın.

### 4. OpenCode / DeepSeek Harness (dsh) / Pi Agent
- **OpenCode**: `~/.config/opencode/config.json` dosyasında `baseUrl: "http://127.0.0.1:8787/v1"` ayarlayın. [OpenCode Kılavuzu](examples/opencode/README.md)na bakın.
- **DeepSeek Harness (dsh)**: `~/.dsh/config.toml` dosyasında `base_url = "http://127.0.0.1:8787/v1"` ayarlayın. [dsh Kılavuzu](examples/dsh/README.md)na bakın.
- **Pi Agent**: `~/.pi/config.json` dosyasında `endpoint: "http://127.0.0.1:8787/v1"` ayarlayın. [Pi Kılavuzu](examples/pi/README.md)na bakın.

---

## Anahtar Yönetimi ve Yapılandırma

### API Anahtarı Yönetimi
Anahtarlar proje kök dizinindeki `.env` dosyasında veya genel `~/.prismd/` dizininde yapılandırılabilir. Arama önceliği (yüksekten düşüğe):
1. **Ortam Değişkenleri**: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` vb.
2. **Geçerli Proje Dizini**: `./.env` (`.env.example` dosyasından kopyalanır)
3. **Genel Kullanıcı Dizini**: `~/.prismd/.env` veya `~/.prismd/keys.yaml` (önerilen izin: `chmod 600`)

### Aday Modelleri ve Sıralamayı Özelleştirme
`config.user.json` dosyasında aday önceliklerini geçersiz kılın veya özel modeller ekleyin, ardından yapılandırmayı yeniden oluşturun:
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
Değişiklikleri uygulamak için `npm run generate:config` (veya `node node_modules/@prismd/prismd/scripts/generate-config.mjs --root <dir>`) komutunu çalıştırın.

Başlıca ücretsiz sağlayıcılar (OpenRouter, Groq, Cerebras, Google Gemini, NVIDIA NIM, GitHub Models vb.) için ayrıntılı kurulum talimatları için [Sağlayıcı Kılavuzları](docs/providers/README.md)na bakın.

---

## Durum ve Gözlemlenebilirlik

- **Web Kontrol Paneli**: Model sağlık durumlarını, günlük kota ilerleme çubuklarını, belirteç kullanımını ve canlı SSE olay akışını görüntülemek için tarayıcınızda `http://127.0.0.1:8787/ui` adresini açın.
- **CLI Durumu**: Renkli ölçüm tablolarını doğrudan terminalde görüntülemek için `prismd status` (veya `npm run status`) komutunu çalıştırın.
- **Yapılandırılmış Günlükler**: Otomatik gizli bilgi maskeleme ve benzersiz `request-id` izleme ile stderr'e yazılan JSON günlükleri.

---

## Çalışma Mantığı ve Sınırlamalar

1. **Yönlendirme ve Filtreleme**:
   - Adayları yapılandırılan sırayla dener;
   - Kotası dolan, bağlam penceresi yetersiz olan veya bekleme süresindeki modelleri kesin olarak hariç tutar;
   - Günlük kota kullanımı %80 veya üzerinde olan modelleri sıranın sonuna kaydırır.
2. **Yük Devretme Sınırları**:
   - **Akış başlamadan önce**: 401/403/429/5xx hatalarında veya bağlantı zaman aşımında `maxCandidatesPerRequest` sayısına kadar bir sonraki adayı dener.
   - **Akış başladıktan sonra**: Bozuk çıktıları önlemek için akış ortasında yeniden deneme yapılmaz; temiz bir SSE `error` olayıyla sonlandırılır.
3. **Ücretsiz Havuz Sınırlamaları**:
   - Genel ücretsiz modeller paylaşılan kapasite havuzlarını kullanır ve yoğun saatlerde sık sık 429 hatası verebilir. prismd bunları otomatik olarak atlatır; tüm adaylar tükenirse `error.metadata` içinde ayrıntılarla birlikte 429 döner.

---

## Sorun Giderme

- **Sık Karşılaşılan 429 Hataları**: Ücretsiz model havuzları yoğundur. Daha az yoğun modelleri önceliklendirmek için `config.user.json` içinde `free-auto` sırasını değiştirin veya başka sağlayıcı anahtarları ekleyin.
- **Güncelleme Sonrası Kaybolan Modeller**: Eski sürümler farklı bir anahtar biçimi kullanıyordu. `prismd.json` dosyasını yenilemek için `npm run generate:config` komutunu çalıştırın.
- **Kota Sayaçlarını Sıfırlama**: Web Kontrol Panelinde (`http://127.0.0.1:8787/ui`) «Reset usage» düğmesine tıklayın veya ağ geçidini durdurup `data/prismd.sqlite` dosyasını silin.
