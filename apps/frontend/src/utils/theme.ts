/**
 * Theme management utilities
 */

export type ThemePreference = 'light' | 'dark' | 'auto';

export const getStoredThemePreference = (): ThemePreference => {
  return 'dark';
};

export const applyTheme = (theme: ThemePreference): void => {
  const root = document.documentElement;
  
  // Enforce dark mode classes and attributes for maximum compatibility
  root.classList.add('dark');
  root.classList.remove('light');
  root.setAttribute('data-theme', 'dark');
  
  if (document.body) {
    document.body.setAttribute('data-theme', 'dark');
  }

  localStorage.setItem('theme', 'dark');
};

export const resolveTheme = (theme: ThemePreference): 'light' | 'dark' => {
  return 'dark';
};

export const saveThemePreference = (theme: ThemePreference): void => {
  localStorage.setItem('theme', 'dark');
};

