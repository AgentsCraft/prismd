export function renderUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>prismd status</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --accent: #58a6ff;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
      --badge-bg: #21262d;
      --active-bg: rgba(56, 139, 253, 0.15);
      --active-border: #388bfd;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 16px 20px;
      min-height: 100vh;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
    }
    .logo-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-title h1 {
      font-size: 1.25rem;
      color: var(--heading);
      font-weight: 600;
      letter-spacing: -0.5px;
    }
    .version-badge {
      font-size: 0.75rem;
      padding: 2px 8px;
      background: var(--badge-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      color: var(--text-muted);
    }
    .header-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 0.875rem;
    }
    .conn-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 14px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .conn-live { background: rgba(63, 185, 80, 0.15); color: var(--green); }
    .conn-poll { background: rgba(210, 153, 34, 0.15); color: var(--yellow); }
    .conn-down { background: rgba(248, 81, 73, 0.15); color: var(--red); }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot-green { background-color: var(--green); box-shadow: 0 0 6px var(--green); }
    .dot-yellow { background-color: var(--yellow); }
    .dot-red { background-color: var(--red); }

    .btn-reset {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      line-height: 1.2;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .btn-reset:hover {
      color: var(--heading);
      border-color: #8b949e;
      background: var(--badge-bg);
    }
    .btn-reset:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #lang-select {
      background: var(--card-bg);
      color: var(--text-muted);
      border: 1px solid var(--card-border);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 0.75rem;
      cursor: pointer;
      outline: none;
      line-height: 1.2;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    #lang-select:hover, #lang-select:focus {
      color: var(--heading);
      border-color: #8b949e;
      background: var(--badge-bg);
    }
    #lang-select option {
      background: var(--card-bg);
      color: var(--text);
    }

    .alias-section {
      margin-bottom: 28px;
    }
    .alias-title {
      font-size: 1.1rem;
      color: var(--heading);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: border-color 0.2s, box-shadow 0.2s;
      position: relative;
    }
    .card.active-candidate {
      border-color: var(--active-border);
      box-shadow: 0 0 0 1px var(--active-border);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .candidate-info {
      display: flex;
      flex-direction: column;
    }
    .provider-name {
      font-size: 0.75rem;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .model-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--heading);
      word-break: break-all;
      margin-top: 2px;
    }
    .active-pill {
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--active-bg);
      color: var(--accent);
      border: 1px solid var(--active-border);
      font-weight: 500;
      white-space: nowrap;
    }

    .quota-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .quota-header {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
    }
    .progress-bar-bg {
      height: 6px;
      background: #21262d;
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .fill-green { background: var(--green); }
    .fill-yellow { background: var(--yellow); }
    .fill-red { background: var(--red); }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      font-size: 0.8rem;
      background: #11141a;
      padding: 8px 12px;
      border-radius: 6px;
    }
    .stat-item {
      display: flex;
      flex-direction: column;
    }
    .stat-label {
      color: var(--text-muted);
      font-size: 0.7rem;
    }
    .stat-value {
      color: var(--heading);
      font-weight: 500;
    }

    .tags-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tag {
      font-size: 0.7rem;
      background: #21262d;
      color: var(--text-muted);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .feature-tag {
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 500;
    }
    .feature-yes { background: rgba(63, 185, 80, 0.1); color: var(--green); }
    .feature-no { background: #21262d; color: var(--text-muted); }

    .health-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      border-top: 1px solid var(--card-border);
      padding-top: 8px;
      margin-top: auto;
    }

    .events-panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      margin-top: 24px;
    }
    .events-title {
      font-size: 0.95rem;
      color: var(--heading);
      font-weight: 600;
      margin-bottom: 12px;
    }
    .events-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 220px;
      overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.75rem;
    }
    .event-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      background: #11141a;
      border-radius: 4px;
      flex-wrap: wrap;
    }
    .event-time { color: var(--text-muted); }
    .event-candidate { color: var(--heading); font-weight: 500; }
    .event-arrow { color: var(--text-muted); }
    .event-reason { color: var(--yellow); }

    .btn-reset {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      line-height: 1.2;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .btn-reset:hover {
      color: var(--heading);
      border-color: #8b949e;
      background: var(--badge-bg);
    }
    .btn-reset:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-title">
      <h1>prismd status</h1>
    </div>
    <div class="header-meta">
      <span id="uptime-text">uptime: —</span>
      <button id="btn-reset-usage" class="btn-reset" title="Reset all usage counters and request logs">Reset usage</button>
      <span id="conn-status" class="conn-badge conn-poll"><span class="dot dot-yellow"></span> Connecting</span>
      <select id="lang-select" aria-label="Language">
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
        <option value="ja">日本語</option>
        <option value="ko">한국어</option>
        <option value="de">Deutsch</option>
        <option value="fr">Français</option>
        <option value="es">Español</option>
        <option value="it">Italiano</option>
        <option value="ar">العربية</option>
        <option value="tr">Türkçe</option>
      </select>
    </div>
  </header>

  <main id="aliases-container"></main>

  <section class="events-panel">
    <div class="events-title">Recent events</div>
    <div id="events-list" class="events-list">
      <div style="color: var(--text-muted); padding: 8px;">No state changes recorded yet.</div>
    </div>
  </section>

  <script>
    const TRANSLATIONS = {
      en: {
        uptime: 'uptime',
        connecting: 'Connecting',
        live: 'Live (SSE)',
        polling: 'Polling (5s)',
        disconnected: 'Disconnected',
        active: '★ Active',
        requests: 'Requests',
        inputTokens: 'Input Tokens',
        outputTokens: 'Output Tokens',
        context: 'Context',
        source: 'Source',
        tools: 'Tools',
        reasoning: 'Reasoning',
        status: 'Status',
        last: 'Last',
        cooldown: 'Cooldown',
        recentEvents: 'Recent events',
        noEvents: 'No state changes recorded yet.',
        resetUsage: 'Reset usage',
        resetConfirm: 'Reset all usage counters and request logs?',
        resetting: 'Resetting...'
      },
      'zh-CN': {
        uptime: '运行时间',
        connecting: '连接中',
        live: '实时 (SSE)',
        polling: '轮询 (5s)',
        disconnected: '已断开',
        active: '★ 活跃',
        requests: '请求数',
        inputTokens: '输入 Token',
        outputTokens: '输出 Token',
        context: '上下文',
        source: '来源',
        tools: '工具',
        reasoning: '推理',
        status: '状态',
        last: '最近错误',
        cooldown: '冷却中',
        recentEvents: '最近事件',
        noEvents: '暂无状态变更记录。',
        resetUsage: '重置用量',
        resetConfirm: '确定要重置所有用量计数器和请求日志吗？',
        resetting: '重置中...'
      },
      ja: {
        uptime: '稼働時間',
        connecting: '接続中',
        live: 'リアルタイム (SSE)',
        polling: 'ポーリング (5s)',
        disconnected: '切断',
        active: '★ アクティブ',
        requests: 'リクエスト数',
        inputTokens: '入力 Token',
        outputTokens: '出力 Token',
        context: 'コンテキスト',
        source: 'ソース',
        tools: 'ツール',
        reasoning: '推論',
        status: 'ステータス',
        last: '直近エラー',
        cooldown: 'クールダウン',
        recentEvents: '最近のイベント',
        noEvents: '記録された状態変更はまだありません。',
        resetUsage: '使用量をリセット',
        resetConfirm: 'すべての使用量カウンターとリクエストログをリセットしますか？',
        resetting: 'リセット中...'
      },
      ko: {
        uptime: '가동 시간',
        connecting: '연결 중',
        live: '실시간 (SSE)',
        polling: '폴링 (5s)',
        disconnected: '연결 끊김',
        active: '★ 활성',
        requests: '요청 수',
        inputTokens: '입력 토큰',
        outputTokens: '출력 토큰',
        context: '컨텍스트',
        source: '소스',
        tools: '도구',
        reasoning: '추론',
        status: '상태',
        last: '최근 오류',
        cooldown: '쿨다운',
        recentEvents: '최근 이벤트',
        noEvents: '기록된 상태 변경이 아직 없습니다.',
        resetUsage: '사용량 초기화',
        resetConfirm: '모든 사용량 카운터 및 요청 로그를 초기화하시겠습니까?',
        resetting: '초기화 중...'
      },
      de: {
        uptime: 'Betriebszeit',
        connecting: 'Verbinden',
        live: 'Live (SSE)',
        polling: 'Polling (5s)',
        disconnected: 'Getrennt',
        active: '★ Aktiv',
        requests: 'Anfragen',
        inputTokens: 'Eingabe-Tokens',
        outputTokens: 'Ausgabe-Tokens',
        context: 'Kontext',
        source: 'Quelle',
        tools: 'Tools',
        reasoning: 'Reasoning',
        status: 'Status',
        last: 'Letzter Fehler',
        cooldown: 'Cooldown',
        recentEvents: 'Aktuelle Ereignisse',
        noEvents: 'Noch keine Statusänderungen aufgezeichnet.',
        resetUsage: 'Nutzung zurücksetzen',
        resetConfirm: 'Möchten Sie wirklich alle Nutzungszähler und Protokolle zurücksetzen?',
        resetting: 'Wird zurückgesetzt...'
      },
      fr: {
        uptime: 'Temps de fonctionnement',
        connecting: 'Connexion',
        live: 'En direct (SSE)',
        polling: 'Interrogation (5s)',
        disconnected: 'Déconnecté',
        active: '★ Actif',
        requests: 'Requêtes',
        inputTokens: 'Tokens d\\'entrée',
        outputTokens: 'Tokens de sortie',
        context: 'Contexte',
        source: 'Source',
        tools: 'Outils',
        reasoning: 'Raisonnement',
        status: 'Statut',
        last: 'Dernière erreur',
        cooldown: 'Temps de recharge',
        recentEvents: 'Événements récents',
        noEvents: 'Aucun changement d\\'état enregistré pour le moment.',
        resetUsage: 'Réinitialiser l\\'utilisation',
        resetConfirm: 'Voulez-vous vraiment réinitialiser tous les compteurs d\\'utilisation et journaux ?',
        resetting: 'Réinitialisation...'
      },
      es: {
        uptime: 'Tiempo de actividad',
        connecting: 'Conectando',
        live: 'En vivo (SSE)',
        polling: 'Sondeo (5s)',
        disconnected: 'Desconectado',
        active: '★ Activo',
        requests: 'Solicitudes',
        inputTokens: 'Tokens de entrada',
        outputTokens: 'Tokens de salida',
        context: 'Contexto',
        source: 'Fuente',
        tools: 'Herramientas',
        reasoning: 'Razonamiento',
        status: 'Estado',
        last: 'Último error',
        cooldown: 'Enfriamiento',
        recentEvents: 'Eventos recientes',
        noEvents: 'Aún no se han registrado cambios de estado.',
        resetUsage: 'Restablecer uso',
        resetConfirm: '¿Está seguro de que desea restablecer todos los contadores de uso y registros?',
        resetting: 'Restableciendo...'
      },
      it: {
        uptime: 'Tempo di attività',
        connecting: 'Connessione',
        live: 'In diretta (SSE)',
        polling: 'Polling (5s)',
        disconnected: 'Disconnesso',
        active: '★ Attivo',
        requests: 'Richieste',
        inputTokens: 'Token di input',
        outputTokens: 'Token di output',
        context: 'Contesto',
        source: 'Origine',
        tools: 'Strumenti',
        reasoning: 'Ragionamento',
        status: 'Stato',
        last: 'Ultimo errore',
        cooldown: 'Cooldown',
        recentEvents: 'Eventi recenti',
        noEvents: 'Nessun cambio di stato registrato.',
        resetUsage: 'Ripristina utilizzo',
        resetConfirm: 'Sei sicuro di voler ripristinare tutti i contatori e i log di utilizzo?',
        resetting: 'Ripristino in corso...'
      },
      ar: {
        uptime: 'وقت التشغيل',
        connecting: 'جارٍ الاتصال',
        live: 'مباشر (SSE)',
        polling: 'استقصاء (5 ثوانٍ)',
        disconnected: 'غير متصل',
        active: '★ نشط',
        requests: 'الطلبات',
        inputTokens: 'رموز الإدخال',
        outputTokens: 'رموز الإخراج',
        context: 'السياق',
        source: 'المصدر',
        tools: 'الأدوات',
        reasoning: 'الاستنتاج',
        status: 'الحالة',
        last: 'آخر خطأ',
        cooldown: 'فترة التهدئة',
        recentEvents: 'الأحداث الأخيرة',
        noEvents: 'لم يتم تسجيل أي تغييرات في الحالة بعد.',
        resetUsage: 'إعادة تعيين الاستخدام',
        resetConfirm: 'هل أنت متأكد من رغبتك في إعادة تعيين جميع عدادات وسجلات الاستخدام؟',
        resetting: 'جارٍ إعادة التعيين...'
      },
      tr: {
        uptime: 'Çalışma süresi',
        connecting: 'Bağlanıyor',
        live: 'Canlı (SSE)',
        polling: 'Yoklama (5 sn)',
        disconnected: 'Bağlantı kesildi',
        active: '★ Aktif',
        requests: 'İstekler',
        inputTokens: 'Girdi Belirteçleri',
        outputTokens: 'Çıktı Belirteçleri',
        context: 'Bağlam',
        source: 'Kaynak',
        tools: 'Araçlar',
        reasoning: 'Akıl Yürütme',
        status: 'Durum',
        last: 'Son Hata',
        cooldown: 'Bekleme Süresi',
        recentEvents: 'Son Olaylar',
        noEvents: 'Henüz kaydedilmiş durum değişikliği yok.',
        resetUsage: 'Kullanımı Sıfırla',
        resetConfirm: 'Tüm kullanım sayaçlarını ve günlükleri sıfırlamak istediğinizden emin misiniz?',
        resetting: 'Sıfırlanıyor...'
      }
    };

    function detectLanguage() {
      try {
        const stored = localStorage.getItem('prismd_lang');
        if (stored && TRANSLATIONS[stored]) return stored;
        const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
        if (nav.startsWith('zh')) return 'zh-CN';
        if (nav.startsWith('ja')) return 'ja';
        if (nav.startsWith('ko')) return 'ko';
        if (nav.startsWith('de')) return 'de';
        if (nav.startsWith('fr')) return 'fr';
        if (nav.startsWith('es')) return 'es';
        if (nav.startsWith('it')) return 'it';
        if (nav.startsWith('ar')) return 'ar';
        if (nav.startsWith('tr')) return 'tr';
      } catch (e) {}
      return 'en';
    }

    const state = {
      lang: detectLanguage(),
      events: [],
      status: null,
      lastConnStatus: null
    };

    function t(key) {
      const dict = TRANSLATIONS[state.lang] || TRANSLATIONS.en;
      return dict[key] || TRANSLATIONS.en[key] || key;
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function formatNumber(num) {
      if (num === null || num === undefined) return '—';
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
      return String(num);
    }

    function formatUptime(seconds) {
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
      if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function updateStaticTexts() {
      document.documentElement.lang = state.lang;
      const eventsTitle = document.querySelector('.events-title');
      if (eventsTitle) eventsTitle.textContent = t('recentEvents');
      if (state.events.length === 0) {
        const list = document.getElementById('events-list');
        if (list) list.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">' + escapeHtml(t('noEvents')) + '</div>';
      }
      const resetBtn = document.getElementById('btn-reset-usage');
      if (resetBtn && !resetBtn.disabled) {
        resetBtn.textContent = t('resetUsage');
      }
      const uptimeEl = document.getElementById('uptime-text');
      if (uptimeEl) {
        uptimeEl.textContent = t('uptime') + ': ' + (state.status ? formatUptime(state.status.uptime) : '—');
      }
      if (state.lastConnStatus) {
        setConnectionStatus(state.lastConnStatus);
      }
    }

    function renderStatus(data) {
      state.status = data;
      document.getElementById('uptime-text').textContent = t('uptime') + ': ' + formatUptime(data.uptime);

      const container = document.getElementById('aliases-container');
      container.innerHTML = '';

      for (const [aliasName, aliasInfo] of Object.entries(data.aliases || {})) {
        const section = document.createElement('div');
        section.className = 'alias-section';

        const title = document.createElement('div');
        title.className = 'alias-title';
        title.innerHTML = '<span>' + escapeHtml(aliasName) + '</span>';
        section.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'card-grid';

        for (const c of aliasInfo.candidates || []) {
          const isActive = aliasInfo.activeCandidate === c.provider + '/' + c.model;
          const card = document.createElement('div');
          card.className = 'card' + (isActive ? ' active-candidate' : '');

          let dotColor = 'dot-green';
          if (c.status === 'rate_limited' || c.status === 'cooldown') dotColor = 'dot-yellow';
          else if (c.status === 'unavailable') dotColor = 'dot-red';

          let requestsText = '— / —';
          let ratioPercent = 0;
          let fillClass = 'fill-green';
          if (c.quota.dailyRequests && c.quota.dailyRequests.limit !== null) {
            const used = c.quota.dailyRequests.used ?? 0;
            const limit = c.quota.dailyRequests.limit;
            const ratio = c.quota.dailyRequests.ratio ?? 0;
            ratioPercent = Math.min(100, Math.round(ratio * 100));
            requestsText = used + ' / ' + limit + ' (' + ratioPercent + '%)';
            if (ratio >= 1.0) fillClass = 'fill-red';
            else if (ratio >= 0.8) fillClass = 'fill-yellow';
          }

          let healthDetails = t('status') + ': ' + escapeHtml(c.status);
          if (c.health.lastError) {
            healthDetails += ' • ' + t('last') + ': ' + escapeHtml(c.health.lastError);
          }
          if (c.health.cooldownRemainingMs > 0) {
            const secs = Math.ceil(c.health.cooldownRemainingMs / 1000);
            healthDetails += ' • ' + t('cooldown') + ': ' + secs + 's';
          }

          card.innerHTML =
            '<div class="card-header">' +
              '<div class="candidate-info">' +
                '<div class="provider-name">' +
                  '<span class="dot ' + dotColor + '"></span>' +
                  escapeHtml(c.provider) +
                '</div>' +
                '<div class="model-name">' + escapeHtml(c.model) + '</div>' +
              '</div>' +
              (isActive ? '<span class="active-pill">' + escapeHtml(t('active')) + '</span>' : '') +
            '</div>' +
            '<div class="quota-block">' +
              '<div class="quota-header">' +
                '<span>' + escapeHtml(t('requests')) + '</span>' +
                '<span>' + requestsText + '</span>' +
              '</div>' +
              '<div class="progress-bar-bg">' +
                '<div class="progress-bar-fill ' + fillClass + '" style="width: ' + ratioPercent + '%"></div>' +
              '</div>' +
            '</div>' +
            '<div class="stats-grid">' +
              '<div class="stat-item">' +
                '<span class="stat-label">' + escapeHtml(t('inputTokens')) + '</span>' +
                '<span class="stat-value">' + formatNumber(c.quota.inputTokens) + '</span>' +
              '</div>' +
              '<div class="stat-item">' +
                '<span class="stat-label">' + escapeHtml(t('outputTokens')) + '</span>' +
                '<span class="stat-value">' + formatNumber(c.quota.outputTokens) + '</span>' +
              '</div>' +
              '<div class="stat-item">' +
                '<span class="stat-label">' + escapeHtml(t('context')) + '</span>' +
                '<span class="stat-value">' + formatNumber(c.contextWindow) + '</span>' +
              '</div>' +
              '<div class="stat-item">' +
                '<span class="stat-label">' + escapeHtml(t('source')) + '</span>' +
                '<span class="stat-value">' + escapeHtml(c.quota.source) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="tags-row">' +
              '<span class="feature-tag ' + (c.supportsTools ? 'feature-yes' : 'feature-no') + '">' + escapeHtml(t('tools')) + ' ' + (c.supportsTools ? '✓' : '✗') + '</span>' +
              (c.supportsReasoning !== undefined ? '<span class="feature-tag ' + (c.supportsReasoning ? 'feature-yes' : 'feature-no') + '">' + escapeHtml(t('reasoning')) + ' ' + (c.supportsReasoning ? '✓' : '✗') + '</span>' : '') +
              (c.tags || []).map(function(tTag) { return '<span class="tag">' + escapeHtml(tTag) + '</span>'; }).join('') +
            '</div>' +
            '<div class="health-meta">' + healthDetails + '</div>';

          grid.appendChild(card);
        }
        section.appendChild(grid);
        container.appendChild(section);
      }
    }

    function addEvent(evt) {
      state.events.unshift(evt);
      if (state.events.length > 50) state.events.pop();

      const list = document.getElementById('events-list');
      list.innerHTML = '';
      for (const e of state.events) {
        const item = document.createElement('div');
        item.className = 'event-item';
        const timeStr = new Date(e.at).toLocaleTimeString();
        item.innerHTML =
          '<span class="event-time">' + timeStr + '</span>' +
          '<span class="event-candidate">' + escapeHtml(e.provider) + '/' + escapeHtml(e.model) + '</span>' +
          '<span>' + escapeHtml(e.from) + '</span>' +
          '<span class="event-arrow">→</span>' +
          '<span>' + escapeHtml(e.to) + '</span>' +
          (e.reason ? '<span class="event-reason">(' + escapeHtml(e.reason) + ')</span>' : '');
        list.appendChild(item);
      }
    }

    function setConnectionStatus(status) {
      state.lastConnStatus = status;
      const el = document.getElementById('conn-status');
      if (status === 'live') {
        el.className = 'conn-badge conn-live';
        el.innerHTML = '<span class="dot dot-green"></span> ' + escapeHtml(t('live'));
      } else if (status === 'poll') {
        el.className = 'conn-badge conn-poll';
        el.innerHTML = '<span class="dot dot-yellow"></span> ' + escapeHtml(t('polling'));
      } else {
        el.className = 'conn-badge conn-down';
        el.innerHTML = '<span class="dot dot-red"></span> ' + escapeHtml(t('disconnected'));
      }
    }

    // Language switcher event listener
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
      langSelect.value = state.lang;
      langSelect.addEventListener('change', function() {
        state.lang = this.value;
        try {
          localStorage.setItem('prismd_lang', state.lang);
        } catch (e) {}
        document.documentElement.lang = state.lang;
        updateStaticTexts();
        if (state.status) {
          renderStatus(state.status);
        }
      });
    }

    // Reset usage button event listener
    const resetBtn = document.getElementById('btn-reset-usage');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        if (!confirm(t('resetConfirm'))) return;
        resetBtn.disabled = true;
        resetBtn.textContent = t('resetting');
        fetch('/v1/usage/reset', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function() {
            return fetch('/v1/modelstatus').then(function(r) { return r.json(); });
          })
          .then(function(data) {
            renderStatus(data);
            resetBtn.textContent = t('resetUsage');
            resetBtn.disabled = false;
          })
          .catch(function(err) {
            alert('Failed to reset: ' + err.message);
            resetBtn.textContent = t('resetUsage');
            resetBtn.disabled = false;
          });
      });
    }

    // Initial static text initialization
    updateStaticTexts();

    // Connect SSE
    function startSSE() {
      if (!window.EventSource) {
        startPolling();
        return;
      }

      const es = new EventSource('/v1/modelstatus/stream');
      let receivedStatus = false;

      es.addEventListener('status', function(e) {
        receivedStatus = true;
        setConnectionStatus('live');
        try {
          const data = JSON.parse(e.data);
          renderStatus(data);
        } catch (err) {
          console.error(err);
        }
      });

      es.addEventListener('candidate_changed', function(e) {
        try {
          const evt = JSON.parse(e.data);
          addEvent(evt);
          // Refresh full status on change
          fetch('/v1/modelstatus')
            .then(function(r) { return r.json(); })
            .then(renderStatus)
            .catch(function() {});
        } catch (err) {
          console.error(err);
        }
      });

      es.onerror = function() {
        es.close();
        if (!receivedStatus) {
          startPolling();
        } else {
          setConnectionStatus('down');
          setTimeout(startSSE, 3000);
        }
      };
    }

    function startPolling() {
      setConnectionStatus('poll');
      function poll() {
        fetch('/v1/modelstatus')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            setConnectionStatus('poll');
            renderStatus(data);
          })
          .catch(function() {
            setConnectionStatus('down');
          });
      }
      poll();
      setInterval(poll, 5000);
    }

    const resetBtn = document.getElementById('btn-reset-usage');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        if (!confirm('Reset all usage counters and request logs?')) return;
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetting...';
        fetch('/v1/usage/reset', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function() {
            return fetch('/v1/modelstatus').then(function(r) { return r.json(); });
          })
          .then(function(data) {
            renderStatus(data);
            resetBtn.textContent = 'Reset usage';
            resetBtn.disabled = false;
          })
          .catch(function(err) {
            alert('Failed to reset: ' + err.message);
            resetBtn.textContent = 'Reset usage';
            resetBtn.disabled = false;
          });
      });
    }

    startSSE();
  </script>
</body>
</html>`;
}
