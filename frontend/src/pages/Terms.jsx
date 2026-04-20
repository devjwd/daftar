import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredLanguagePreference } from '../utils/language';
import './Terms.css';

const LAST_UPDATED = 'March 14, 2026';

const SECTIONS = [
  {
    title: '1. Scope',
    body: [
      'These Terms of Service govern your access to and use of Daftar, including the website, dashboard, wallet connection flow, profile features, badge features, beta functionality, and related content we make available through the app.',
      'By using Daftar, you agree to these terms. If you do not agree, do not use the service.'
    ]
  },
  {
    title: '2. Eligibility',
    body: [
      'You must use Daftar only if you can form a binding agreement under the laws that apply to you and only if access to this type of service is lawful in your jurisdiction.',
      'You are responsible for complying with any local rules, sanctions, tax rules, consumer protection rules, or digital asset restrictions that apply to your use.'
    ]
  },
  {
    title: '3. Nature of the Service',
    body: [
      'Daftar is a non-custodial portfolio and discovery interface. We display onchain and third-party data, surface wallet information, and may provide experimental product features such as swap, badges, leaderboard, or level-related experiences.',
      'Daftar does not take custody of your assets, does not execute transactions on your behalf, and does not provide brokerage, exchange, investment, legal, or tax services.'
    ]
  },
  {
    title: '4. Wallets and Accounts',
    body: [
      'You are solely responsible for your wallet, private keys, seed phrases, devices, browser extensions, and any approvals or signatures submitted from your wallet.',
      'If you connect a wallet, you represent that you are authorized to use it and understand the consequences of any signature or transaction prompt presented by a wallet provider or third-party protocol.'
    ]
  },
  {
    title: '5. Beta Features and Availability',
    body: [
      'Some features are labeled beta, coming soon, or otherwise unfinished. Those features may be incomplete, inaccurate, unavailable, removed, or substantially changed at any time without notice.',
      'We do not guarantee continuous uptime, uninterrupted access, data accuracy, historical completeness, or compatibility with any chain, wallet, protocol, browser, or device.'
    ]
  },
  {
    title: '6. Acceptable Use',
    body: [
      'You may not use Daftar to violate law, infringe rights, bypass access controls, interfere with other users, overload infrastructure, scrape restricted data in abusive ways, distribute malware, impersonate others, or use the service for fraud, market manipulation, or unlawful financial activity.',
      'You may not attempt to reverse engineer, disrupt, or extract source logic from parts of the service except where applicable law clearly permits that activity.'
    ]
  },
  {
    title: '7. Third-Party Services and Data',
    body: [
      'Daftar relies on third-party wallets, RPC endpoints, indexers, token price feeds, protocols, and external websites. Those services are outside our control and may affect functionality, pricing, balances, availability, or transaction status.',
      'Links to GitHub, Discord, protocol websites, documentation, or other resources are provided for convenience only. Your use of third-party services is governed by their own terms and policies.'
    ]
  },
  {
    title: '8. Intellectual Property',
    body: [
      'Except for open-source components or third-party materials made available under their own licenses, Daftar and its branding, interface design, copy, and original materials remain the property of the project or its licensors.',
      'You may use the service for its intended purpose, but you may not copy, resell, republish, or create derivative commercial materials from our protected content without permission.'
    ]
  },
  {
    title: '9. No Financial Advice and Risk Disclosure',
    body: [
      'Information shown in Daftar is for general informational use only. Nothing on the site is a recommendation, solicitation, endorsement, or offer relating to any asset, protocol, transaction, or strategy.',
      'Digital assets and onchain activity involve substantial risk, including smart contract bugs, exploits, loss of access, pricing volatility, oracle failures, bridge failures, governance changes, regulatory changes, and irreversible transactions. You accept those risks when using the service.'
    ]
  },
  {
    title: '10. Disclaimers',
    body: [
      'Daftar is provided on an as-is and as-available basis to the maximum extent permitted by law. We disclaim warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, reliability, and uninterrupted availability.',
      'We do not guarantee that balances, valuations, badge eligibility, leaderboard placement, swap outcomes, or any analytics shown in the interface are complete, current, or error-free.'
    ]
  },
  {
    title: '11. Limitation of Liability',
    body: [
      'To the maximum extent permitted by law, Daftar and its contributors will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for loss of profits, revenue, data, goodwill, tokens, or digital assets arising from or related to your use of the service.',
      'If liability cannot be excluded, our aggregate liability for claims related to the service will be limited to the greater of one hundred U.S. dollars or the amount you paid us directly for the relevant service in the twelve months before the claim.'
    ]
  },
  {
    title: '12. Suspension and Termination',
    body: [
      'We may suspend, restrict, or terminate access to any part of Daftar at any time, including where we believe use creates security, legal, operational, or reputational risk.',
      'You may stop using the service at any time. Sections that by their nature should survive termination will remain in effect.'
    ]
  },
  {
    title: '13. Changes to These Terms',
    body: [
      'We may update these terms as the product evolves. When we do, we will update the last-updated date on this page. Continued use of Daftar after changes become effective means you accept the revised terms.'
    ]
  },
  {
    title: '14. Contact',
    body: [
      'If you need to reach the project about these terms, use the official Discord community or open an issue through the project GitHub repository linked in the app menu.'
    ]
  }
];

export default function Terms() {
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
    <div className="terms-page">
      <div className="terms-shell">
        <div className="terms-hero">
          <button type="button" onClick={() => navigate(-1)} className="terms-back-btn" aria-label="Go back">
            ←
          </button>
          <div className="terms-hero-copy">
            <span className="terms-kicker">Legal</span>
            <h1>Terms of Service</h1>
            <p>
              These terms apply to Daftar as a wallet-connected portfolio interface and experimental onchain product.
              Please read them carefully before using the app.
            </p>
            <div className="terms-meta">
              <span>Last updated {LAST_UPDATED}</span>
              <span>{language.toUpperCase()}</span>
            </div>
          </div>
        </div>

        <div className="terms-highlight">
          <strong>Important:</strong> Daftar is non-custodial, informational, and still evolving. You remain responsible for your wallet, your signatures, and any actions you take with third-party protocols.
        </div>

        <div className="terms-sections">
          {SECTIONS.map((section) => (
            <section key={section.title} className="terms-section">
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