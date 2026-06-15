import { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { getSupabase } from '../../config/supabase.ts';
import { getEffectiveTier } from '../../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';

let discordClient: Client | null = null;

export function getDiscordClient(): Client | null {
  return discordClient;
}

export async function verifyUserRoles(discordUserId: string, walletAddress: string) {
  if (!discordClient) return;
  const guildId = process.env.DISCORD_GUILD_ID;
  const verifiedRoleId = process.env.DISCORD_VERIFIED_ROLE_ID;
  const proRoleId = process.env.DISCORD_PRO_ROLE_ID;

  if (!guildId) return;

  try {
    const guild = await discordClient.guilds.fetch(guildId);
    if (!guild) return;

    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!member) return;

    const supabase = getSupabase();
    let isPro = false;
    if (supabase) {
      const tier = await getEffectiveTier(supabase, walletAddress);
      isPro = isPremiumTier(tier);
    }

    if (verifiedRoleId) {
      await member.roles.add(verifiedRoleId).catch(console.error);
    }

    if (proRoleId) {
      if (isPro) {
        await member.roles.add(proRoleId).catch(console.error);
      } else {
        await member.roles.remove(proRoleId).catch(console.error);
      }
    }
    console.log(`[DiscordBot] Verified roles for user ${discordUserId}`);
  } catch (error) {
    console.error('[DiscordBot] Error assigning roles:', error);
  }
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
    },
    {
      name: 'setup_verify',
      description: 'Admin: Post the server verification message.',
      default_member_permissions: String(PermissionFlagsBits.ManageGuild)
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
      // Direct user to Discord OAuth2 flow so they authenticate via daftar.fi frontend
      // This is consistent with the frontend "Connect Discord" button which uses OAuth2
      const webappUrl = process.env.NODE_ENV === 'production' ? 'https://daftar.fi' : 'http://localhost:3000';
      const redirectUri = encodeURIComponent(`${webappUrl}/settings`);
      const clientId = process.env.DISCORD_CLIENT_ID;
      const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;

      const embed = new EmbedBuilder()
        .setTitle('🔗 Link Your Wallet to Discord')
        .setDescription(
          `To securely receive real-time notifications, you need to link your Movement wallet with your Discord account.\n\n` +
          `**Steps:**\n` +
          `1. Click the link below to open Daftar Settings.\n` +
          `2. Connect your Movement wallet (e.g. Razor, Nightly).\n` +
          `3. Click the **\"Connect Discord\"** button — you'll be redirected back here automatically.\n\n` +
          `[👉 Click here to connect your Discord account](${oauthUrl})`
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
          `• \`/setup_verify\` - Admin: Set up the server verification message.\n` +
          `• \`/help\` - Show this information.`
        )
        .setColor(0xD4AF37);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    else if (commandName === 'setup_verify') {
      const embed = new EmbedBuilder()
        .setTitle('Verify your wallet')
        .setDescription('Click on the link below to verify your Movement wallet and receive your roles.\n\nYou will receive a role update when verification is complete.')
        .setColor(0x00FF00); // Green

      const verifyButton = new ButtonBuilder()
        .setCustomId('verify_movement_wallet')
        .setLabel('Verify Movement')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton);

      await interaction.reply({ content: 'Verification message setup successfully.', ephemeral: true });
      if (interaction.channel && 'send' in interaction.channel) {
        await (interaction.channel as any).send({ embeds: [embed], components: [row] });
      }
    }
  });

  // Handle Button Interactions
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'verify_movement_wallet') {
      const webappUrl = process.env.NODE_ENV === 'production' ? 'https://daftar.fi' : 'http://localhost:3000';
      const redirectUri = encodeURIComponent(`${webappUrl}/settings`);
      const clientId = process.env.DISCORD_CLIENT_ID;
      const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;

      const embed = new EmbedBuilder()
        .setTitle('🔗 Verify Your Wallet')
        .setDescription(
          `Click on the link below to verify. Follow the instructions on the page to gain new roles in the Discord Server.\n\n` +
          `[Verify now](${oauthUrl})`
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
