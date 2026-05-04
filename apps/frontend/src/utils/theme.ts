/**
 * Theme management utilities
 */

export type ThemePreference = 'light' | 'dark' | 'auto';

export const getStoredThemePreference = (): ThemePreference => {
  const stored = localStorage.getItem('theme') as ThemePreference | null;
  return stored || 'auto';
};

export const applyTheme = (theme: ThemePreference): void => {
  const root = document.documentElement;
  let effectiveTheme = theme;

  if (theme === 'auto') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  if (effectiveTheme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }

  localStorage.setItem('theme', theme);
};

export const resolveTheme = (theme: ThemePreference): 'light' | 'dark' => {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
};

export const saveThemePreference = (theme: ThemePreference): void => {
  localStorage.setItem('theme', theme);
};

