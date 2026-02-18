const THEME_KEY = "theme";
const GLOBAL_SETTINGS_KEY = "settings_global";

const isThemeValue = (value) => value === "dark" || value === "light" || value === "auto";

export const getSystemTheme = () => {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const resolveTheme = (preference) => {
  if (preference === "auto") return getSystemTheme();
  return preference === "light" ? "light" : "dark";
};

export const getStoredThemePreference = (settingsKey = null) => {
  if (typeof window === "undefined") return "dark";

  if (settingsKey) {
    try {
      const scopedRaw = window.localStorage.getItem(settingsKey);
      if (scopedRaw) {
        const scoped = JSON.parse(scopedRaw);
        if (isThemeValue(scoped?.theme)) {
          return scoped.theme;
        }
      }
    } catch {
      // ignore malformed localStorage
    }
  }

  try {
    const globalRaw = window.localStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (globalRaw) {
      const globalSettings = JSON.parse(globalRaw);
      if (isThemeValue(globalSettings?.theme)) {
        return globalSettings.theme;
      }
    }
  } catch {
    // ignore malformed localStorage
  }

  const plainTheme = window.localStorage.getItem(THEME_KEY);
  return isThemeValue(plainTheme) ? plainTheme : "dark";
};

export const applyTheme = (preference) => {
  if (typeof document === "undefined") return "dark";

  const normalizedPreference = isThemeValue(preference) ? preference : "dark";
  const resolvedTheme = resolveTheme(normalizedPreference);

  document.documentElement.setAttribute("data-theme", resolvedTheme);
  document.body.setAttribute("data-theme", resolvedTheme);

  window.dispatchEvent(
    new CustomEvent("themechange", {
      detail: {
        preference: normalizedPreference,
        resolvedTheme,
      },
    })
  );

  return resolvedTheme;
};

export const saveThemePreference = (theme, settingsKey = null) => {
  const preference = isThemeValue(theme) ? theme : "dark";

  if (typeof window === "undefined") {
    return preference;
  }

  window.localStorage.setItem(THEME_KEY, preference);

  try {
    const globalRaw = window.localStorage.getItem(GLOBAL_SETTINGS_KEY);
    const globalSettings = globalRaw ? JSON.parse(globalRaw) : {};
    globalSettings.theme = preference;
    window.localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(globalSettings));
  } catch {
    window.localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify({ theme: preference }));
  }

  if (settingsKey) {
    try {
      const scopedRaw = window.localStorage.getItem(settingsKey);
      const scopedSettings = scopedRaw ? JSON.parse(scopedRaw) : {};
      scopedSettings.theme = preference;
      window.localStorage.setItem(settingsKey, JSON.stringify(scopedSettings));
    } catch {
      window.localStorage.setItem(settingsKey, JSON.stringify({ theme: preference }));
    }
  }

  applyTheme(preference);
  return preference;
};
