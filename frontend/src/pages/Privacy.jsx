import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredLanguagePreference } from '../utils/language';
import './Privacy.css';

const LAST_UPDATED = 'March 14, 2026';

const SECTIONS = [
  {
    title: '1. Overview',
    body: [
      'This Privacy Policy explains how Daftar handles information when you visit the website, connect a wallet, use portfolio features, interact with profile features, or contact the project through channels linked from the app.',
      'Daftar is designed as a non-custodial interface. We do not hold private keys or take possession of your digital assets.'
    ]
  },
  {
    title: '2. Information We May Process',
    body: [
      'Depending on how you use the product, we may process wallet addresses, public onchain data associated with those addresses, profile information you choose to publish, support messages you send, technical logs, browser metadata, device information, approximate geolocation derived from network requests, and usage events needed to operate and secure the service.',
      'Much of the blockchain data displayed in Daftar is already public by nature. Using the interface may make it easier for that public information to be viewed, aggregated, or contextualized.'
    ]
  },
  {
    title: '3. How We Use Information',
    body: [
      'We use information to provide the app, load balances and protocol positions, personalize visible settings, secure the service, debug reliability issues, respond to support inquiries, investigate abuse, and improve product performance and usability.',
      'We may also use aggregated or de-identified information for analytics, product planning, and operational reporting.'
    ]
  },
  {
    title: '4. Wallet Connections and Public Blockchain Data',
    body: [
      'When you connect or search a wallet, Daftar may query public blockchain infrastructure, indexers, price feeds, and related data providers to display information tied to that address.',
      'Wallet addresses, token balances, NFT holdings, transaction history, DeFi positions, badge eligibility, and similar onchain information may be visible to other users if those features are exposed through the product and the underlying data is public.'
    ]
  },
  {
    title: '5. Cookies, Local Storage, and Similar Technologies',
    body: [
      'Daftar may use local storage or similar browser-based mechanisms to remember preferences such as theme, language, recent searches, and product settings. These items help the interface work as expected and improve continuity across visits.',
      'If analytics, rate limiting, anti-abuse tooling, or infrastructure monitoring are enabled, those systems may also use technical identifiers necessary for reliability and security.'
    ]
  },
  {
    title: '6. Third-Party Services',
    body: [
      'Daftar relies on third-party providers such as wallet adapters, RPC endpoints, indexers, token price sources, hosting providers, content delivery providers, analytics tools, and linked social or community platforms. Those services may receive technical request data when you use the app.',
      'Each third-party provider operates under its own privacy practices. We are not responsible for the privacy or security practices of external services you access from links, wallet prompts, protocol integrations, GitHub, Discord, Telegram, or documentation pages.'
    ]
  },
  {
    title: '7. Legal Bases and Processing Rationale',
    body: [
      'Where applicable law requires a legal basis, we process information to provide the service you request, pursue legitimate interests in operating and securing the product, comply with legal obligations, and where required, based on your consent.'
    ]
  },
  {
    title: '8. Data Sharing',
    body: [
      'We may share information with service providers, infrastructure partners, advisors, contractors, analytics vendors, security vendors, or legal authorities when reasonably necessary to operate the service, comply with law, protect users, enforce our terms, or support a reorganization, financing, or transfer of the project.',
      'We do not sell personal information in the ordinary course of operating Daftar.'
    ]
  },
  {
    title: '9. Data Retention',
    body: [
      'We retain information for as long as reasonably necessary to operate the service, preserve security logs, resolve disputes, enforce agreements, meet legal obligations, and maintain business records. Retention periods may vary depending on the type of data and the reason it was collected.',
      'Because blockchain data is public and stored on decentralized networks, we generally cannot delete or modify information that has already been recorded onchain.'
    ]
  },
  {
    title: '10. International Transfers',
    body: [
      'Daftar may use infrastructure and service providers located in different countries. As a result, information may be processed outside your country of residence, including in jurisdictions with different data protection standards.'
    ]
  },
  {
    title: '11. Your Choices and Rights',
    body: [
      'Depending on where you live, you may have rights to access, correct, delete, restrict, object to, or export certain personal information, and to withdraw consent where processing is based on consent. Those rights can be limited by law, technical feasibility, security needs, and the public nature of blockchain records.',
      'You can also choose not to connect a wallet, avoid using optional profile features, clear local browser storage, or stop using the service at any time.'
    ]
  },
  {
    title: '12. Security',
    body: [
      'We take reasonable steps to protect information we control, but no website, API, hosting platform, wallet integration, or internet transmission is completely secure. You should use appropriate wallet hygiene, device protection, and operational security when interacting with any blockchain application.'
    ]
  },
  {
    title: '13. Children',
    body: [
      'Daftar is not intended for children where collection of personal information from minors would be prohibited without appropriate authorization. If you believe information was provided improperly, contact the project so it can be reviewed.'
    ]
  },
  {
    title: '14. Changes to This Policy',
    body: [
      'We may update this Privacy Policy from time to time as the product, infrastructure, legal requirements, or data practices evolve. When we do, we will revise the last-updated date on this page.'
    ]
  },
  {
    title: '15. Contact',
    body: [
      'For privacy-related questions, use the project Discord or GitHub repository linked in the app menu. Avoid sharing sensitive secrets, seed phrases, or private keys in any support channel.'
    ]
  }
];

export default function Privacy() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState(() => getStoredLanguagePreference());

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

  return (
    <div className="privacy-page">
      <div className="privacy-shell">
        <div className="privacy-hero">
          <button type="button" onClick={() => navigate(-1)} className="privacy-back-btn" aria-label="Go back">
            ←
          </button>
          <div className="privacy-hero-copy">
            <span className="privacy-kicker">Privacy</span>
            <h1>Privacy Policy</h1>
            <p>
              This policy explains what data Daftar may process, why it may be processed,
              and what that means for a wallet-connected portfolio product built on public blockchain data.
            </p>
            <div className="privacy-meta">
              <span>Last updated {LAST_UPDATED}</span>
              <span>{language.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <div className="privacy-highlight">
          <strong>Important:</strong> Blockchain activity is generally public. Even where Daftar minimizes what it stores directly, public wallet activity may still be visible through the app and other services.
        </div>

        <div className="privacy-sections">
          {SECTIONS.map((section) => (
            <section key={section.title} className="privacy-section">
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}