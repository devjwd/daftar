import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredLanguagePreference } from '../utils/language';
import { getStoredThemePreference, saveThemePreference } from '../utils/theme';
import './More.css';

export default function More() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(getStoredThemePreference());
  const [language, setLanguage] = useState(getStoredLanguagePreference());

  useEffect(() => {
    const syncLanguage = () => setLanguage(getStoredLanguagePreference());
    const onLanguageChange = (event) => {
      if (event?.detail?.language) {
        setLanguage(event.detail.language);
      } else {
        syncLanguage();
      }
    };

    window.addEventListener('languagechange', onLanguageChange);
    window.addEventListener('storage', syncLanguage);
    return () => {
      window.removeEventListener('languagechange', onLanguageChange);
      window.removeEventListener('storage', syncLanguage);
    };
  }, []);

  const handleThemeChange = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    saveThemePreference(newTheme, 'settings_global');
  };

  const handleLanguageClick = () => {
    navigate('/settings');
  };

  const handleResourcesClick = () => {
    window.open('https://docs.movementnetwork.xyz/', '_blank');
  };

  const handleLevelClick = () => {
    navigate('/level');
  };

  const handleSupportClick = () => {
    window.open('https://discord.gg/movementlabsxyz', '_blank');
  };

  return (
    <div className="more-page">
      <div className="more-container">
        <div className="more-header">
          <button onClick={() => navigate(-1)} className="more-back-btn">
            ←
          </button>
          <h1>More</h1>
        </div>

        <div className="more-options">
          <button className="more-option" onClick={handleLevelClick}>
            <div className="more-option-left">
              <div className="more-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M17 7H7V3H17V7ZM5 9H19V11H5V9ZM7 13H17V21H7V13Z" fill="currentColor"/>
                </svg>
              </div>
              <span>Level</span>
            </div>
            <div className="more-option-right">→</div>
          </button>
          <button className="more-option" onClick={handleSupportClick}>
            <div className="more-option-left">
              <div className="more-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 19H11V17H13V19ZM15.07 11.25L14.17 12.17C13.45 12.9 13 13.5 13 15H11V14.5C11 13.4 11.45 12.4 12.17 11.67L13.41 10.41C13.78 10.05 14 9.55 14 9C14 7.9 13.1 7 12 7C10.9 7 10 7.9 10 9H8C8 6.79 9.79 5 12 5C14.21 5 16 6.79 16 9C16 9.88 15.64 10.68 15.07 11.25Z" fill="currentColor"/>
                </svg>
              </div>
              <span>Support</span>
            </div>
          </button>

          <button className="more-option" onClick={handleThemeChange}>
            <div className="more-option-left">
              <div className="more-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 3C11.45 3 11 3.45 11 4V5C11 5.55 11.45 6 12 6C12.55 6 13 5.55 13 5V4C13 3.45 12.55 3 12 3ZM18 12C18 11.45 18.45 11 19 11H20C20.55 11 21 11.45 21 12C21 12.55 20.55 13 20 13H19C18.45 13 18 12.55 18 12ZM6 12C6 11.45 5.55 11 5 11H4C3.45 11 3 11.45 3 12C3 12.55 3.45 13 4 13H5C5.55 13 6 12.55 6 12ZM12 18C11.45 18 11 18.45 11 19V20C11 20.55 11.45 21 12 21C12.55 21 13 20.55 13 20V19C13 18.45 12.55 18 12 18ZM17.66 6.34C17.27 5.95 16.64 5.95 16.25 6.34L15.54 7.05C15.15 7.44 15.15 8.07 15.54 8.46C15.93 8.85 16.56 8.85 16.95 8.46L17.66 7.75C18.05 7.36 18.05 6.73 17.66 6.34ZM6.34 17.66C5.95 17.27 5.95 16.64 6.34 16.25L7.05 15.54C7.44 15.15 8.07 15.15 8.46 15.54C8.85 15.93 8.85 16.56 8.46 16.95L7.75 17.66C7.36 18.05 6.73 18.05 6.34 17.66ZM8.46 8.46C8.85 8.07 8.85 7.44 8.46 7.05L7.75 6.34C7.36 5.95 6.73 5.95 6.34 6.34C5.95 6.73 5.95 7.36 6.34 7.75L7.05 8.46C7.44 8.85 8.07 8.85 8.46 8.46ZM12 9C10.34 9 9 10.34 9 12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12C15 10.34 13.66 9 12 9Z" fill="currentColor"/>
                </svg>
              </div>
              <span>Theme</span>
            </div>
            <div className="more-option-right">
              →
            </div>
          </button>

          <button className="more-option" onClick={handleLanguageClick}>
            <div className="more-option-left">
              <div className="more-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12C2 17.52 6.47 22 11.99 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 11.99 2ZM18.92 8H15.97C15.65 6.75 15.19 5.55 14.59 4.44C16.43 5.07 17.96 6.35 18.92 8ZM12 4.04C12.83 5.24 13.48 6.57 13.91 8H10.09C10.52 6.57 11.17 5.24 12 4.04ZM4.26 14C4.1 13.36 4 12.69 4 12C4 11.31 4.1 10.64 4.26 10H7.64C7.56 10.66 7.5 11.32 7.5 12C7.5 12.68 7.56 13.34 7.64 14H4.26ZM5.08 16H8.03C8.35 17.25 8.81 18.45 9.41 19.56C7.57 18.93 6.04 17.66 5.08 16ZM8.03 8H5.08C6.04 6.34 7.57 5.07 9.41 4.44C8.81 5.55 8.35 6.75 8.03 8ZM12 19.96C11.17 18.76 10.52 17.43 10.09 16H13.91C13.48 17.43 12.83 18.76 12 19.96ZM14.34 14H9.66C9.57 13.34 9.5 12.68 9.5 12C9.5 11.32 9.57 10.65 9.66 10H14.34C14.43 10.65 14.5 11.32 14.5 12C14.5 12.68 14.43 13.34 14.34 14ZM14.59 19.56C15.19 18.45 15.65 17.25 15.97 16H18.92C17.96 17.65 16.43 18.93 14.59 19.56ZM16.36 14C16.44 13.34 16.5 12.68 16.5 12C16.5 11.32 16.44 10.66 16.36 10H19.74C19.9 10.64 20 11.31 20 12C20 12.69 19.9 13.36 19.74 14H16.36Z" fill="currentColor"/>
                </svg>
              </div>
              <span>Language</span>
            </div>
            <div className="more-option-right">
              <span className="language-badge">{language.toUpperCase()}</span>
              →
            </div>
          </button>

          <button className="more-option" onClick={handleResourcesClick}>
            <div className="more-option-left">
              <div className="more-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 6H12L10 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6ZM20 18H4V8H20V18Z" fill="currentColor"/>
                </svg>
              </div>
              <span>Resources</span>
            </div>
            <div className="more-option-right">
              →
            </div>
          </button>
        </div>

        <div className="social-links">
          <a 
            href="https://x.com/movementlabsxyz" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="social-link"
            aria-label="X (Twitter)"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
          <a 
            href="https://discord.gg/movementlabsxyz" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="social-link"
            aria-label="Discord"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          </a>
          <a 
            href="https://t.me/movementlabsxyz" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="social-link"
            aria-label="Telegram"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
            </svg>
          </a>
          <a 
            href="https://github.com/movementlabsxyz" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="social-link"
            aria-label="GitHub"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
            </svg>
          </a>
        </div>

        <div className="more-footer">
          <a href="https://movementlabs.xyz/terms" target="_blank" rel="noopener noreferrer" className="footer-link">
            Terms Of Business
          </a>
          <span className="footer-separator">•</span>
          <a href="https://movementlabs.xyz/privacy" target="_blank" rel="noopener noreferrer" className="footer-link">
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
}
