import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Shield, Zap, Lock, MessageSquare, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

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
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 md:p-12 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl w-full text-center z-10"
      >
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/20 text-primary mb-8 ring-1 ring-primary/30 shadow-lg shadow-primary/20">
          <Bot size={40} />
        </div>

        <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400 leading-tight">
          Supercharge Your Web3 Community
        </h1>
        
        <p className="text-lg md:text-xl text-neutral-400 mb-10 max-w-2xl mx-auto leading-relaxed">
          Invite the Daftar Bot to your Discord server and provide your members with seamless portfolio tracking, Web3 verification, and powerful moderation tools.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
          <a 
            href={discordInviteUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-black font-semibold px-8 py-4 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)] w-full sm:w-auto justify-center"
          >
            <Bot size={20} />
            Add to Discord
          </a>
          <p className="text-sm text-neutral-500 mt-2 sm:mt-0 sm:ml-4">
            Free forever. No complex setup.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * idx }}
                className="bg-card p-6 rounded-2xl border border-border hover:border-primary/50 transition-colors group"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform">
                  <Icon size={24} />
                </div>
                <h3 className="text-xl font-semibold text-text mb-2">{feature.title}</h3>
                <p className="text-neutral-400 leading-relaxed">{feature.description}</p>
              </motion.div>
            );
          })}
        </div>

        <div className="mt-20 p-8 bg-black/40 border border-border rounded-2xl backdrop-blur-sm">
          <h2 className="text-2xl font-bold mb-4">Are you a Server Admin?</h2>
          <p className="text-neutral-400 mb-6">
            If you've already invited the bot, run the <code className="bg-background px-2 py-1 rounded text-primary">/dashboard</code> command in your Discord server to get a secure magic link to configure your roles and channels!
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default BotLandingPage;
