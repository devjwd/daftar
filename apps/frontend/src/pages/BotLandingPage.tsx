import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Shield, Zap, Lock, MessageSquare, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import './BotLandingPage.css';

const BotLandingPage: React.FC = () => {
  // Use Discord OAuth2 URL (Replace client ID appropriately in prod)
  const discordInviteUrl = `https://discord.com/oauth2/authorize?client_id=1310118320499261541&permissions=8&scope=bot%20applications.commands`;

  const features = [
    {
      icon: Shield,
      title: "Secure Verification",
      description: "Human captcha verification and Web3 Wallet linking for Sybil resistance."
    },
    {
      icon: Zap,
      title: "Real-Time Tracking",
      description: "Users can check their portfolio, XP, and live token prices right in Discord."
    },
    {
      icon: Lock,
      title: "Anti-Spam & Modlogs",
      description: "Automatically deletes malicious links and logs message edits/deletions."
    },
    {
      icon: MessageSquare,
      title: "Support Tickets",
      description: "Built-in private ticketing system with transcript DMs."
    }
  ];

  return (
    <div className="bot-landing-container">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div style={{ display: 'inline-flex', marginBottom: '2rem', color: 'var(--primary)', background: 'rgba(212,175,55,0.1)', padding: '1rem', borderRadius: '1rem', border: '1px solid rgba(212,175,55,0.2)' }}>
          <Bot size={48} />
        </div>

        <h1 className="bot-landing-title">
          Supercharge Your Web3 Community
        </h1>
        
        <p className="bot-landing-desc">
          Invite the Daftar Bot to your Discord server and provide your members with seamless portfolio tracking, Web3 verification, and powerful moderation tools.
        </p>

        <div style={{ marginBottom: '4rem' }}>
          <a 
            href={discordInviteUrl}
            target="_blank"
            rel="noreferrer"
            className="bot-landing-btn"
          >
            <Bot size={20} />
            Add to Discord
          </a>
          <p style={{ marginTop: '1rem', color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
            Free forever. No complex setup.
          </p>
        </div>

        <div className="bot-features-grid">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * idx }}
                className="bot-feature-card"
              >
                <div style={{ marginBottom: '1rem', color: 'var(--primary)' }}>
                  <Icon size={32} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </motion.div>
            );
          })}
        </div>

        <div className="bot-admin-note">
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Are you a Server Admin?</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            If you've already invited the bot, run the <code>/dashboard</code> command in your Discord server to get a secure magic link to configure your roles and channels!
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default BotLandingPage;
