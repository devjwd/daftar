import { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder } from 'discord.js';
import { getSupabase } from '../../config/supabase.ts';
import { getEffectiveTier } from '../../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';

let discordClient: Client | null = null;

export function getDiscordClient(): Client | null {
  return discordClient;
}

export async function initDiscordBot(): Promise<Client | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    console.warn('[DiscordBot] DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID is not configured in .env. Discord bot will not start.');
    return null;
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
  });

  // Register Slash Commands
  const commands = [
    {
      name: 'link',
      description: 'Link your movement wallet address to receive transaction notifications.',
    },
    {
      name: 'portfolio',
      description: 'View the portfolio breakdown of your linked wallet address.',
    },
    {
      name: 'help',
      description: 'List all commands and status information.',
    }
  ];

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('[DiscordBot] Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log('[DiscordBot] Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('[DiscordBot] Failed to register slash commands:', error);
  }

  discordClient.on('ready', () => {
    console.log(`[DiscordBot] 🤖 Logged in as ${discordClient?.user?.tag}!`);
  });

  // Handle Slash Command Interactions
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const userId = interaction.user.id;
    const supabase = getSupabase();

    if (!supabase) {
      return interaction.reply({ content: '⚠️ Database service is currently offline. Please try again later.', ephemeral: true });
    }

    if (commandName === 'link') {
      // Return link to frontend settings page with Discord User ID payload
      // To secure linking, the user must log in to the frontend, connect their wallet, and sign a message.
      const webappUrl = process.env.NODE_ENV === 'production' ? 'https://daftar.fi' : 'http://localhost:3000';
      const linkUrl = `${webappUrl}/settings?discord_user_id=${userId}`;

      const embed = new EmbedBuilder()
        .setTitle('🔗 Link Your Wallet to Discord')
        .setDescription(
          `To securely receive real-time notifications when your wallet makes trades or receives/withdraws funds, click the link below to verify ownership of your wallet.\n\n` +
          `**Steps:**\n` +
          `1. Click the button/link below to open Daftar.\n` +
          `2. Connect your Movement wallet (e.g. Razor, Nightly).\n` +
          `3. Click **"Verify & Link Discord"** and sign the prompt.\n\n` +
          `[👉 Click here to link your wallet](${linkUrl})`
        )
        .setColor(0xD4AF37)
        .setFooter({ text: 'Notifications are exclusive to Pro subscription tiers' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'portfolio') {
      await interaction.deferReply({ ephemeral: true });
      try {
        // Find wallet associated with this discord user id
        const { data: config, error } = await supabase
          .from('user_alert_configs')
          .select('wallet_address')
          .eq('discord_user_id', userId)
          .maybeSingle();

        if (error) throw error;
        if (!config) {
          return interaction.editReply({
            content: '❌ You have not linked your wallet yet. Please run `/link` first to connect your account.'
          });
        }

        const wallet = config.wallet_address;

        // Fetch latest net worth snapshot
        const { data: snapshot } = await supabase
          .from('user_networth_snapshots')
          .select('*')
          .eq('user_address', wallet)
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!snapshot) {
          return interaction.editReply({
            content: `📊 **Portfolio for** \`${wallet}\`\n\nNo snapshots found. Please wait for the system indexer to sync your profile.`
          });
        }

        const total = Number(snapshot.total_networth_usd || 0);
        const walletBalance = Number(snapshot.wallet_usd || 0);
        const defiBalance = Number(snapshot.defi_usd || 0);
        const nftBalance = Number(snapshot.nft_usd || 0);

        const embed = new EmbedBuilder()
          .setTitle(`📊 Portfolio for ${wallet.slice(0, 6)}...${wallet.slice(-4)}`)
          .setURL(`https://daftar.fi/profile/${wallet}`)
          .setDescription(`Here is the asset distribution for the wallet linked to your Discord account.`)
          .addFields(
            { name: '💰 Total Net Worth', value: `**$${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD**`, inline: false },
            { name: '👛 Wallet Balance', value: `$${walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, inline: true },
            { name: '🏦 DeFi Deposited', value: `$${defiBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, inline: true },
            { name: '🎨 NFT Floor Value', value: `$${nftBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, inline: true }
          )
          .setColor(0xD4AF37)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        console.error('[DiscordBot] Portfolio fetch error:', err);
        await interaction.editReply({ content: '❌ Failed to retrieve portfolio details.' });
      }
    }

    else if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('💡 Daftar Discord Bot Help')
        .setDescription(
          `Manage your alert notifications and query your Movement portfolio balances directly within Discord.\n\n` +
          `**Commands:**\n` +
          `• \`/link\` - Connect your Movement wallet to your Discord account.\n` +
          `• \`/portfolio\` - Show net worth distribution for your linked wallet.\n` +
          `• \`/help\` - Show this information.`
        )
        .setColor(0xD4AF37);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  });

  try {
    await discordClient.login(token);
  } catch (err) {
    console.error('[DiscordBot] Login failed:', err);
    discordClient = null;
  }

  return discordClient;
}
