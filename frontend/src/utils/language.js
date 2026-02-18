const LANGUAGE_KEY = "language";
const GLOBAL_SETTINGS_KEY = "settings_global";

export const SUPPORTED_LANGUAGES = ["en", "zh", "ko", "tr"];

const normalizeLanguage = (value) => {
  const candidate = String(value || "").toLowerCase();
  return SUPPORTED_LANGUAGES.includes(candidate) ? candidate : "en";
};

export const getStoredLanguagePreference = (settingsKey = null) => {
  if (typeof window === "undefined") return "en";

  if (settingsKey) {
    try {
      const scopedRaw = window.localStorage.getItem(settingsKey);
      if (scopedRaw) {
        const scoped = JSON.parse(scopedRaw);
        return normalizeLanguage(scoped?.language);
      }
    } catch {
      // ignore malformed localStorage
    }
  }

  try {
    const globalRaw = window.localStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (globalRaw) {
      const globalSettings = JSON.parse(globalRaw);
      const lang = normalizeLanguage(globalSettings?.language);
      if (lang) return lang;
    }
  } catch {
    // ignore malformed localStorage
  }

  return normalizeLanguage(window.localStorage.getItem(LANGUAGE_KEY));
};

export const saveLanguagePreference = (language, settingsKey = null) => {
  const normalized = normalizeLanguage(language);

  if (typeof window === "undefined") {
    return normalized;
  }

  window.localStorage.setItem(LANGUAGE_KEY, normalized);

  try {
    const globalRaw = window.localStorage.getItem(GLOBAL_SETTINGS_KEY);
    const globalSettings = globalRaw ? JSON.parse(globalRaw) : {};
    globalSettings.language = normalized;
    window.localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(globalSettings));
  } catch {
    window.localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify({ language: normalized }));
  }

  if (settingsKey) {
    try {
      const scopedRaw = window.localStorage.getItem(settingsKey);
      const scopedSettings = scopedRaw ? JSON.parse(scopedRaw) : {};
      scopedSettings.language = normalized;
      window.localStorage.setItem(settingsKey, JSON.stringify(scopedSettings));
    } catch {
      window.localStorage.setItem(settingsKey, JSON.stringify({ language: normalized }));
    }
  }

  window.dispatchEvent(
    new CustomEvent("languagechange", {
      detail: { language: normalized },
    })
  );

  return normalized;
};

const TRANSLATIONS = {
  en: {
    navPortfolio: "PORTFOLIO",
    navSwap: "SWAP",
    navBadges: "BADGES",
    navLeaderboard: "LEADERBOARD",
    navMore: "MORE",
    menuSupport: "Support",
    menuTheme: "Theme",
    menuSettings: "Settings",
    menuResources: "Resources",
    searchPlaceholder: "Search address / username / move id",
    recentSearches: "Recent Searches",
    searchBlockchain: "Searching blockchain...",
    noProfilesFound: "No profiles found. Enter a valid 0x address to search the blockchain.",
    lookupOnChain: "Look up {address} on-chain",
    walletAddress: "Wallet address",
    onChain: "On-chain",
    profile: "Profile",
    address: "Address",
    connectWallet: "Connect Wallet",
    disconnect: "Disconnect",
    settingsTitle: "Settings",
    settingsSubtitle: "Customize your portfolio experience",
    backToPortfolio: "Back to Portfolio",
    display: "Display",
    currency: "Currency",
    currencyDescription: "Choose your preferred currency",
    theme: "Theme",
    themeDescription: "Select your theme preference",
    language: "Language",
    languageDescription: "Choose your language",
    notifications: "Notifications",
    enableNotifications: "Enable Notifications",
    enableNotificationsDescription: "Receive updates about your portfolio",
    priceAlerts: "Price Alerts",
    priceAlertsDescription: "Get notified of significant price changes",
    advanced: "Advanced",
    showTestnet: "Show Testnet",
    showTestnetDescription: "Include testnet tokens in portfolio",
    resetDefault: "Reset to Default",
    saveSettings: "Save Settings",
    dark: "Dark",
    light: "Light",
    auto: "Auto",
    english: "English",
    chinese: "Chinese",
    korean: "Korean",
    turkish: "Turkish",
  },
  zh: {
    navPortfolio: "投资组合",
    navSwap: "兑换",
    navBadges: "徽章",
    navLeaderboard: "排行榜",
    navMore: "更多",
    menuSupport: "支持",
    menuTheme: "主题",
    menuSettings: "设置",
    menuResources: "资源",
    searchPlaceholder: "搜索地址 / 用户名 / move id",
    recentSearches: "最近搜索",
    searchBlockchain: "正在搜索链上数据...",
    noProfilesFound: "未找到资料。请输入有效的 0x 地址进行链上搜索。",
    lookupOnChain: "在链上查询 {address}",
    walletAddress: "钱包地址",
    onChain: "链上",
    profile: "资料",
    address: "地址",
    connectWallet: "连接钱包",
    disconnect: "断开连接",
    settingsTitle: "设置",
    settingsSubtitle: "自定义你的投资组合体验",
    backToPortfolio: "返回投资组合",
    display: "显示",
    currency: "货币",
    currencyDescription: "选择你偏好的货币",
    theme: "主题",
    themeDescription: "选择主题偏好",
    language: "语言",
    languageDescription: "选择语言",
    notifications: "通知",
    enableNotifications: "启用通知",
    enableNotificationsDescription: "接收投资组合更新",
    priceAlerts: "价格提醒",
    priceAlertsDescription: "接收显著价格变化提醒",
    advanced: "高级",
    showTestnet: "显示测试网",
    showTestnetDescription: "在投资组合中包含测试网代币",
    resetDefault: "重置为默认",
    saveSettings: "保存设置",
    dark: "深色",
    light: "浅色",
    auto: "自动",
    english: "英语",
    chinese: "中文",
    korean: "韩语",
    turkish: "土耳其语",
  },
  ko: {
    navPortfolio: "포트폴리오",
    navSwap: "스왑",
    navBadges: "배지",
    navLeaderboard: "리더보드",
    navMore: "더보기",
    menuSupport: "지원",
    menuTheme: "테마",
    menuSettings: "설정",
    menuResources: "리소스",
    searchPlaceholder: "주소 / 사용자명 / move id 검색",
    recentSearches: "최근 검색",
    searchBlockchain: "블록체인 검색 중...",
    noProfilesFound: "프로필을 찾을 수 없습니다. 유효한 0x 주소를 입력해 체인을 검색하세요.",
    lookupOnChain: "체인에서 {address} 조회",
    walletAddress: "지갑 주소",
    onChain: "온체인",
    profile: "프로필",
    address: "주소",
    connectWallet: "지갑 연결",
    disconnect: "연결 해제",
    settingsTitle: "설정",
    settingsSubtitle: "포트폴리오 환경을 맞춤 설정하세요",
    backToPortfolio: "포트폴리오로 돌아가기",
    display: "표시",
    currency: "통화",
    currencyDescription: "선호 통화를 선택하세요",
    theme: "테마",
    themeDescription: "테마 선호도를 선택하세요",
    language: "언어",
    languageDescription: "언어를 선택하세요",
    notifications: "알림",
    enableNotifications: "알림 활성화",
    enableNotificationsDescription: "포트폴리오 업데이트를 받습니다",
    priceAlerts: "가격 알림",
    priceAlertsDescription: "중요한 가격 변동 알림을 받습니다",
    advanced: "고급",
    showTestnet: "테스트넷 표시",
    showTestnetDescription: "포트폴리오에 테스트넷 토큰 포함",
    resetDefault: "기본값으로 재설정",
    saveSettings: "설정 저장",
    dark: "다크",
    light: "라이트",
    auto: "자동",
    english: "영어",
    chinese: "중국어",
    korean: "한국어",
    turkish: "터키어",
  },
  tr: {
    navPortfolio: "PORTFÖY",
    navSwap: "TAKAS",
    navBadges: "ROZETLER",
    navLeaderboard: "LİDERLİK",
    navMore: "DAHA FAZLA",
    menuSupport: "Destek",
    menuTheme: "Tema",
    menuSettings: "Ayarlar",
    menuResources: "Kaynaklar",
    searchPlaceholder: "Adres / kullanıcı adı / move id ara",
    recentSearches: "Son Aramalar",
    searchBlockchain: "Zincir aranıyor...",
    noProfilesFound: "Profil bulunamadı. Zinciri aramak için geçerli bir 0x adresi girin.",
    lookupOnChain: "Zincirde {address} ara",
    walletAddress: "Cüzdan adresi",
    onChain: "Zincirde",
    profile: "Profil",
    address: "Adres",
    connectWallet: "Cüzdanı Bağla",
    disconnect: "Bağlantıyı Kes",
    settingsTitle: "Ayarlar",
    settingsSubtitle: "Portföy deneyimini özelleştir",
    backToPortfolio: "Portföye Dön",
    display: "Görünüm",
    currency: "Para Birimi",
    currencyDescription: "Tercih ettiğiniz para birimini seçin",
    theme: "Tema",
    themeDescription: "Tema tercihinizi seçin",
    language: "Dil",
    languageDescription: "Dilinizi seçin",
    notifications: "Bildirimler",
    enableNotifications: "Bildirimleri Etkinleştir",
    enableNotificationsDescription: "Portföy güncellemelerini alın",
    priceAlerts: "Fiyat Uyarıları",
    priceAlertsDescription: "Önemli fiyat değişimlerinde bildirim alın",
    advanced: "Gelişmiş",
    showTestnet: "Testnet Göster",
    showTestnetDescription: "Portföyde testnet tokenlarını göster",
    resetDefault: "Varsayılana Sıfırla",
    saveSettings: "Ayarları Kaydet",
    dark: "Koyu",
    light: "Açık",
    auto: "Otomatik",
    english: "İngilizce",
    chinese: "Çince",
    korean: "Korece",
    turkish: "Türkçe",
  },
};

export const t = (language, key, vars = {}) => {
  const lang = normalizeLanguage(language);
  const value = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key;

  return Object.entries(vars).reduce(
    (result, [varKey, varValue]) => result.replaceAll(`{${varKey}}`, String(varValue)),
    value
  );
};
