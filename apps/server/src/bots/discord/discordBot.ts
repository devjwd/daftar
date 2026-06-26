import { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ApplicationCommandOptionType, ChannelType, TextChannel, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ModalActionRowComponentBuilder } from 'discord.js';
import jwt from 'jsonwebtoken';
import { getSupabase } from '../../config/supabase.ts';
import { getEffectiveTier } from '../../services/subscriptionService.ts';
import { isPremiumTier } from '@daftar/shared-types';

let discordClient: Client | null = null;

export function getDiscordClient(): Client | null {
  return discordClient;
}

export async function verifyUserRoles(discordUserId: string, walletAddress: string) {
  if (!discordClient) return;

  const supabase = getSupabase();
  if (!supabase) return;

  let isPro = false;
  const tier = await getEffectiveTier(supabase, walletAddress);
  isPro = isPremiumTier(tier);

  const guilds = discordClient.guilds.cache;
  if (!guilds || guilds.size === 0) return;

  let dmSent = false;

  for (const [_, guild] of guilds) {
    try {
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) continue;

      const verifiedRole = guild.roles.cache.find((r: any) => r.name.toLowerCase() === 'verified');
      const proRole = guild.roles.cache.find((r: any) => r.name.toLowerCase() === 'pro');

      if (verifiedRole) {
        await member.roles.add(verifiedRole).catch(console.error);
      }

      if (proRole) {
        if (isPro) {
          await member.roles.add(proRole).catch(console.error);
        } else {
          await member.roles.remove(proRole).catch(console.error);
        }
      }

      // Send a DM confirmation to the user ONLY ONCE
      if (!dmSent) {
        const dmEmbed = new EmbedBuilder()
          .setTitle('✅ Verification Successful!')
          .setDescription(`Your Movement wallet (\`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}\`) has been successfully linked to your Discord profile!\n\nYou have been granted the **Verified** roles across your communities.`)
          .setColor(0x00FF00)
          .setTimestamp();

        await member.send({ embeds: [dmEmbed] }).catch(() => null);
        dmSent = true;
      }

      // Also send a public message in the #verify channel
      const verifyChannel = guild.channels.cache.find((c: any) => c.name.toLowerCase() === 'verify' && c.type === ChannelType.GuildText) as TextChannel | undefined;
      if (verifyChannel && 'send' in verifyChannel) {
        const publicEmbed = new EmbedBuilder()
          .setDescription(`🎉 <@${discordUserId}> has successfully linked their Movement wallet and is now **Verified**!`)
          .setColor(0x00FF00);

        await verifyChannel.send({ embeds: [publicEmbed] }).catch(() => null);
      }

    } catch (error) {
      console.error(`[DiscordBot] Error assigning roles for guild:`, error);
    }
  }
}

async function logModAction(guild: any, action: string, moderator: any, target: any, reason: string) {
  if (!guild) return;

  const modlogChannel = guild.channels.cache.find((c: any) => c.name.toLowerCase() === 'modlogs' && c.type === ChannelType.GuildText) as TextChannel | undefined;

  if (!modlogChannel || !('send' in modlogChannel)) return;

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Moderation: ${action}`)
    .setColor(0xFFA500)
    .addFields(
      { name: 'Target', value: `${target} (${target.id})`, inline: true },
      { name: 'Moderator', value: `${moderator} (${moderator.id})`, inline: true },
      { name: 'Reason', value: reason, inline: false }
    )
    .setTimestamp();

  await modlogChannel.send({ embeds: [embed] }).catch(console.error);
}


async function checkDiscordRateLimit(userId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return true;
  const { data, error } = await supabase.rpc('check_discord_rate_limit', { p_user_id: userId });
  if (error) {
    console.error('[DiscordBot] Rate limit RPC error:', error.message);
    return true; // Fail open if RPC doesn't exist
  }
  if (data === false) return false;
  return true;
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
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message]
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
    },
    {
      name: 'kick',
      description: 'Admin: Kick a user from the server.',
      default_member_permissions: String(PermissionFlagsBits.KickMembers),
      options: [
        { name: 'user', description: 'User to kick', type: ApplicationCommandOptionType.User, required: true },
        { name: 'reason', description: 'Reason for kicking', type: ApplicationCommandOptionType.String, required: false }
      ]
    },
    {
      name: 'ban',
      description: 'Admin: Ban a user from the server.',
      default_member_permissions: String(PermissionFlagsBits.BanMembers),
      options: [
        { name: 'user', description: 'User to ban', type: ApplicationCommandOptionType.User, required: true },
        { name: 'reason', description: 'Reason for banning', type: ApplicationCommandOptionType.String, required: false }
      ]
    },
    {
      name: 'timeout',
      description: 'Admin: Timeout a user.',
      default_member_permissions: String(PermissionFlagsBits.ModerateMembers),
      options: [
        { name: 'user', description: 'User to timeout', type: ApplicationCommandOptionType.User, required: true },
        { name: 'duration', description: 'Duration in minutes', type: ApplicationCommandOptionType.Integer, required: true },
        { name: 'reason', description: 'Reason for timeout', type: ApplicationCommandOptionType.String, required: false }
      ]
    },
    {
      name: 'clear',
      description: 'Admin: Bulk delete messages.',
      default_member_permissions: String(PermissionFlagsBits.ManageMessages),
      options: [
        { name: 'amount', description: 'Number of messages to delete (1-100)', type: ApplicationCommandOptionType.Integer, required: true }
      ]
    },
    {
      name: 'setup_tickets',
      description: 'Admin: Post the support ticket creation message.',
      default_member_permissions: String(PermissionFlagsBits.ManageGuild)
    },
    {
      name: 'profile',
      description: 'View your Daftar platform profile, level, and badges!',
    },
    {
      name: 'xp',
      description: 'View your current Daftar XP and Level.',
    },
    {
      name: 'price',
      description: 'View live token prices (MOVE, BTC, ETH).',
    },
    {
      name: 'network',
      description: 'View current Movement network status.',
    },
    {
      name: 'unlink',
      description: 'Unlink your Movement wallet from your Discord account.',
    },
    {
      name: 'alert',
      description: 'Configure your Daftar real-time transaction and price alerts.',
      options: [
        { name: 'enable_price_alerts', description: 'Receive DMs for big price moves', type: ApplicationCommandOptionType.Boolean, required: false },
        { name: 'price_change_percent', description: 'Percentage move to trigger price alert (e.g. 5, 10)', type: ApplicationCommandOptionType.Number, required: false },
        { name: 'alert_on_received', description: 'Receive DMs when you receive tokens', type: ApplicationCommandOptionType.Boolean, required: false },
        { name: 'alert_on_withdrawal', description: 'Receive DMs when you send tokens', type: ApplicationCommandOptionType.Boolean, required: false },
        { name: 'alert_on_swaps', description: 'Receive DMs when you swap tokens', type: ApplicationCommandOptionType.Boolean, required: false }
      ]
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

  discordClient.on('messageDelete', async (message) => {
    if (message.partial) await message.fetch().catch(() => null);
    if (!message.author || message.author.bot || !message.guild) return;

    const modlogChannel = message.guild.channels.cache.find(c => c.name.toLowerCase() === 'modlogs' && c.type === ChannelType.GuildText) as TextChannel | undefined;
    if (!modlogChannel || !('send' in modlogChannel)) return;

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Message Deleted')
      .setColor(0xFF0000)
      .addFields(
        { name: 'Author', value: `${message.author} (${message.author.id})`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Content', value: message.content || '*No text content*', inline: false }
      )
      .setTimestamp();

    await modlogChannel.send({ embeds: [embed] }).catch(console.error);
  });

  discordClient.on('messageUpdate', async (oldMessage, newMessage) => {
    if (oldMessage.partial) await oldMessage.fetch().catch(() => null);
    if (newMessage.partial) await newMessage.fetch().catch(() => null);

    if (!oldMessage.author || oldMessage.author.bot || !oldMessage.guild) return;
    if (oldMessage.content === newMessage.content) return; // Only log text changes

    const modlogChannel = oldMessage.guild.channels.cache.find(c => c.name.toLowerCase() === 'modlogs' && c.type === ChannelType.GuildText) as TextChannel | undefined;
    if (!modlogChannel || !('send' in modlogChannel)) return;

    const embed = new EmbedBuilder()
      .setTitle('✏️ Message Edited')
      .setColor(0xFFA500)
      .addFields(
        { name: 'Author', value: `${oldMessage.author} (${oldMessage.author.id})`, inline: true },
        { name: 'Channel', value: `${oldMessage.channel}`, inline: true },
        { name: 'Before', value: oldMessage.content || '*No text content*', inline: false },
        { name: 'After', value: newMessage.content || '*No text content*', inline: false }
      )
      .setTimestamp();

    await modlogChannel.send({ embeds: [embed] }).catch(console.error);
  });

  discordClient.on('guildMemberAdd', async (member) => {
    const embed = new EmbedBuilder()
      .setTitle(`Welcome to ${member.guild.name}! 👋`)
      .setDescription(
        `We are thrilled to have you here, ${member}!\n\n` +
        `**To gain full access to the server:**\n` +
        `Please navigate to the **#verify** channel and click the verification button to unlock community channels and claim your roles.\n\n` +
        `If you need any help, feel free to open a ticket.`
      )
      .setColor(0x5865F2)
      .setThumbnail(member.guild.iconURL())
      .setTimestamp();

    await member.send({ embeds: [embed] }).catch(() => {
      console.log(`[DiscordBot] Could not send welcome DM to ${member.user.tag}`);
    });
  });

  // Anti-Spam & Link Protection
  const whitelistedDomains = [
    'daftar.fi',
    'discord.com',
    'discord.gg',
    'twitter.com',
    'x.com',
    'tenor.com',
    'giphy.com',
    'youtube.com',
    'youtu.be',
    'github.com'
  ];

  discordClient.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Check if user has admin or mod permissions (they bypass the filter)
    if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const links = message.content.match(urlRegex);

    if (links) {
      let containsBadLink = false;
      for (const link of links) {
        try {
          const url = new URL(link);
          const domain = url.hostname.toLowerCase();

          // Check if domain ends with any of the whitelisted domains
          const isWhitelisted = whitelistedDomains.some(white => domain === white || domain.endsWith('.' + white));

          if (!isWhitelisted) {
            containsBadLink = true;
            break;
          }
        } catch (e) {
          // Unparseable URL, might be obfuscated spam
          containsBadLink = true;
          break;
        }
      }

      if (containsBadLink) {
        await message.delete().catch(() => null);

        const warning = await message.channel.send(`⚠️ ${message.author}, posting unauthorized links is not allowed in this server to prevent scams!`);
        setTimeout(() => warning.delete().catch(() => null), 5000);

        const modlogChannel = message.guild.channels.cache.find(c => c.name.toLowerCase() === 'modlogs' && c.type === ChannelType.GuildText) as TextChannel | undefined;
        if (modlogChannel && 'send' in modlogChannel) {
          const embed = new EmbedBuilder()
            .setTitle('🛡️ Anti-Spam Link Removed')
            .setColor(0xFF0000)
            .addFields(
              { name: 'Author', value: `${message.author} (${message.author.id})`, inline: true },
              { name: 'Channel', value: `${message.channel}`, inline: true },
              { name: 'Content', value: message.content, inline: false }
            )
            .setTimestamp();
          await modlogChannel.send({ embeds: [embed] }).catch(() => null);
        }
      }
    }
  });


  // Handle Slash Command Interactions
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const userId = interaction.user.id;

    const allowed = await checkDiscordRateLimit(userId);
    if (!allowed) {
      return interaction.reply({ content: '⏳ Please slow down! Wait a few seconds before using another command.', ephemeral: true });
    }
    const supabase = getSupabase();

    if (!supabase) {
      return interaction.reply({ content: '⚠️ Database service is currently offline. Please try again later.', ephemeral: true });
    }

    if (commandName === 'link') {
      // Direct user to Discord OAuth2 flow so they authenticate via daftar.fi frontend
      // This is consistent with the frontend "Connect Discord" button which uses OAuth2
      const webappUrl = process.env.FRONTEND_URL || 'https://daftar.fi';
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

    else if (commandName === 'profile') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const { data: config, error } = await supabase
          .from('user_alert_configs')
          .select('wallet_address')
          .eq('discord_user_id', userId)
          .maybeSingle();

        if (error) throw error;
        if (!config || !config.wallet_address) {
          return interaction.editReply({
            content: '❌ You haven\'t linked your Daftar profile yet! Go to the `#verify` channel and click the button to link your account.'
          });
        }

        const wallet = config.wallet_address;

        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('wallet_address', wallet)
          .maybeSingle();

        const { count: badgeCount } = await supabase
          .from('badge_attestations')
          .select('*', { count: 'exact', head: true })
          .eq('wallet_address', wallet)
          .eq('eligible', true);

        const level = Math.floor((profile?.xp || 0) / 1000) + 1;

        const embed = new EmbedBuilder()
          .setTitle(`👤 ${profile?.username || 'Daftar User'}'s Profile`)
          .setDescription(profile?.bio || '*No bio provided.*')
          .addFields(
            { name: 'Level', value: `${level} 🌟`, inline: true },
            { name: 'XP', value: `${profile?.xp || 0} XP`, inline: true },
            { name: 'Badges Earned', value: `${badgeCount || 0} 🏅`, inline: true },
            { name: 'Subscription', value: profile?.subscription_tier === 'pro' || profile?.subscription_tier === 'lite' ? '💎 Premium' : 'Free Tier', inline: true },
            { name: 'Wallet', value: `\`${wallet.slice(0, 6)}...${wallet.slice(-4)}\``, inline: false }
          )
          .setColor(0xD4AF37)
          .setThumbnail(profile?.avatar_url || interaction.user.displayAvatarURL());

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        console.error('[DiscordBot] Profile fetch error:', err);
        await interaction.editReply({ content: '❌ Failed to retrieve profile details.' });
      }
    }

    else if (commandName === 'xp') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const { data: config } = await supabase
          .from('user_alert_configs')
          .select('wallet_address')
          .eq('discord_user_id', userId)
          .maybeSingle();

        if (!config || !config.wallet_address) {
          return interaction.editReply({ content: '❌ You haven\'t linked your wallet yet! Use `/link`.' });
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('xp')
          .eq('wallet_address', config.wallet_address)
          .maybeSingle();

        const xp = profile?.xp || 0;
        const level = Math.floor(xp / 1000) + 1;
        const nextLevelXp = level * 1000;
        const progress = Math.floor((xp % 1000) / 1000 * 100);

        const embed = new EmbedBuilder()
          .setTitle('⚡ Daftar Experience Points')
          .setDescription(`You are currently **Level ${level}**!`)
          .addFields(
            { name: 'Total XP', value: `${xp.toLocaleString()} XP`, inline: true },
            { name: 'Next Level', value: `${nextLevelXp.toLocaleString()} XP (${progress}%)`, inline: true }
          )
          .setColor(0x00FF00);

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        console.error('[DiscordBot] XP error:', err);
        await interaction.editReply({ content: '❌ Failed to fetch XP.' });
      }
    }

    else if (commandName === 'price') {
      await interaction.deferReply({ ephemeral: false });
      try {
        const tokenIds = [
          '0x1',
          '0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c',
          '0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376',
        ];

        const { data: prices, error } = await supabase
          .from('price_cache')
          .select('token_id, price_usd, change_24h, cached_at')
          .in('token_id', tokenIds);

        if (error) throw error;

        const priceMap: Record<string, { price: number; change: number; cachedAt: string }> = {};
        if (prices) {
          prices.forEach(p => {
            priceMap[p.token_id] = {
              price: Number(p.price_usd),
              change: Number(p.change_24h || 0),
              cachedAt: p.cached_at
            };
          });
        }

        const move = priceMap['0x1'];
        const btc = priceMap['0xb06f29f24dde9c6daeec1f930f14a441a8d6c0fbea590725e88b340af3e1939c'];
        const eth = priceMap['0x908828f4fb0213d4034c3ded1630bbd904e8a3a6bf3c63270887f0b06653a376'];

        const formatLine = (symbol: string, data: typeof move | undefined) => {
          if (!data) return `**${symbol}:** Price unavailable`;
          const sign = data.change >= 0 ? '+' : '';
          const emoji = data.change >= 0 ? '🟢' : '🔴';
          return `${emoji} **${symbol}:** $${data.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: symbol === 'MOVE' ? 5 : 2 })} (${sign}${data.change.toFixed(2)}%)`;
        };

        const embed = new EmbedBuilder()
          .setTitle('💹 Live Token Prices')
          .setDescription(
            `${formatLine('MOVE', move)}\n` +
            `${formatLine('BTC', btc)}\n` +
            `${formatLine('ETH', eth)}\n`
          )
          .setColor(0xD4AF37)
          .setFooter({ text: 'Source: CoinGecko' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        console.error('[DiscordBot] Price error:', err);
        await interaction.editReply({ content: '❌ Failed to fetch prices.' });
      }
    }

    else if (commandName === 'network') {
      await interaction.deferReply({ ephemeral: false });
      try {
        const rpcUrl = process.env.MOVEMENT_RPC_URL || 'https://mainnet.movementnetwork.xyz/v1';
        const response = await fetch(rpcUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error(`RPC returned ${response.status}`);

        const data: any = await response.json();

        const blockHeight = Number(data.block_height || 0).toLocaleString();
        const epoch = data.epoch || 'N/A';
        const ledgerVersion = Number(data.ledger_version || 0).toLocaleString();

        const embed = new EmbedBuilder()
          .setTitle('🌐 Movement Network Status')
          .setDescription(
            `**Block Height:** ${blockHeight}\n` +
            `**Epoch:** ${epoch}\n` +
            `**Ledger Version:** ${ledgerVersion}`
          )
          .setColor(0x5865F2)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        console.error('[DiscordBot] Network error:', err);
        await interaction.editReply({ content: '❌ Failed to fetch network status. RPC may be down.' });
      }
    }

    else if (commandName === 'alert') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const { data: config, error } = await supabase
          .from('user_alert_configs')
          .select('*')
          .eq('discord_user_id', userId)
          .maybeSingle();

        if (error) throw error;
        if (!config || !config.wallet_address) {
          return interaction.editReply({
            content: '❌ Your Discord account is not currently linked to any wallet. Use `/link` first.'
          });
        }

        const updates: any = {};
        
        const enablePrice = interaction.options.getBoolean('enable_price_alerts');
        const priceThreshold = interaction.options.getNumber('price_change_percent');
        const onReceive = interaction.options.getBoolean('alert_on_received');
        const onSend = interaction.options.getBoolean('alert_on_withdrawal');
        const onSwap = interaction.options.getBoolean('alert_on_swaps');

        if (enablePrice !== null) updates.alert_on_price_change = enablePrice;
        if (priceThreshold !== null) updates.price_alert_threshold = priceThreshold;
        if (onReceive !== null) updates.alert_on_received = onReceive;
        if (onSend !== null) updates.alert_on_withdrawal = onSend;
        if (onSwap !== null) updates.alert_on_swaps = onSwap;

        if (Object.keys(updates).length > 0) {
          await supabase
            .from('user_alert_configs')
            .update(updates)
            .eq('wallet_address', config.wallet_address);
        }

        // Fetch updated config
        const { data: updatedConfig } = await supabase
          .from('user_alert_configs')
          .select('*')
          .eq('wallet_address', config.wallet_address)
          .single();

        const embed = new EmbedBuilder()
          .setTitle('🔔 Alert Configuration Updated')
          .setDescription(`Your alert preferences for \`${config.wallet_address}\` have been updated!`)
          .addFields(
            { name: 'Price Alerts', value: updatedConfig.alert_on_price_change ? `✅ Enabled (±${updatedConfig.price_alert_threshold}%)` : '❌ Disabled', inline: false },
            { name: 'Receives', value: updatedConfig.alert_on_received ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Withdrawals', value: updatedConfig.alert_on_withdrawal ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Swaps', value: updatedConfig.alert_on_swaps ? '✅ Enabled' : '❌ Disabled', inline: true }
          )
          .setColor(0x00FF00);

        await interaction.editReply({ embeds: [embed] });

      } catch (err: any) {
        console.error('[DiscordBot] Alert config error:', err);
        await interaction.editReply({ content: '❌ Failed to update alert settings.' });
      }
    }

    else if (commandName === 'unlink') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const { data: config, error } = await supabase
          .from('user_alert_configs')
          .select('*')
          .eq('discord_user_id', userId)
          .maybeSingle();

        if (error) throw error;
        if (!config || !config.wallet_address) {
          return interaction.editReply({
            content: '❌ Your Discord account is not currently linked to any wallet.'
          });
        }

        // Unlink by updating the database
        await supabase
          .from('user_alert_configs')
          .update({ discord_user_id: null, discord_enabled: false })
          .eq('wallet_address', config.wallet_address);

        // Remove the Pro role if they have it
        const proRoleId = process.env.DISCORD_PRO_ROLE_ID;
        if (proRoleId && interaction.guild) {
          const member = await interaction.guild.members.fetch(userId).catch(() => null);
          if (member && member.roles.cache.has(proRoleId)) {
            await member.roles.remove(proRoleId).catch(console.error);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('🔗 Wallet Unlinked')
          .setDescription(`Successfully disconnected wallet \`${config.wallet_address}\` from your Discord account.\n\nYou will no longer receive direct messages for platform events and your Pro roles have been removed.`)
          .setColor(0xFF0000);

        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        console.error('[DiscordBot] Unlink error:', err);
        await interaction.editReply({ content: '❌ Failed to unlink wallet.' });
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
        .setTitle('🛡️ Server Verification')
        .setDescription(
          'Welcome to the **Daftar Official Discord**!\n\n' +
          'Choose your preferred method to gain access to the server:\n\n' +
          '**🟢 Option 1: Basic Verification**\n' +
          'Simply click the **Verify** button below to prove you are human and unlock standard community channels.\n\n' +
          '**🔗 Option 2: Secure Wallet Linking (Recommended)**\n' +
          'Connect your Movement wallet to gain standard access **PLUS**:\n' +
          '• Display your `Verified` wallet badge\n' +
          '• Receive real-time DMs for platform actions\n' +
          '• Gain `Pro` roles automatically if you hold an active subscription'
        )
        .setColor(0xD4AF37)
        .setFooter({ text: 'Powered by Daftar', iconURL: discordClient?.user?.displayAvatarURL() });

      const basicVerifyBtn = new ButtonBuilder()
        .setCustomId('basic_verify')
        .setLabel('Verify')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🛡️');

      const linkWalletBtn = new ButtonBuilder()
        .setCustomId('verify_movement_wallet')
        .setLabel('Link Wallet')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🔗');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(basicVerifyBtn, linkWalletBtn);

      await interaction.reply({ content: 'Verification message setup successfully.', ephemeral: true });
      if (interaction.channel && 'send' in interaction.channel) {
        await (interaction.channel as any).send({ embeds: [embed], components: [row] }).catch((err: any) => {
          console.error('Failed to send verify msg:', err);
          interaction.followUp({ content: '❌ Failed to post message. Make sure the bot has "Send Messages" permission in this channel!', ephemeral: true });
        });
      }
    }

    else if (commandName === 'kick') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!user) return interaction.reply({ content: 'User not found.', ephemeral: true });

      const member = await interaction.guild?.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: 'User is not in the server.', ephemeral: true });

      const moderator = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (moderator && member.roles.highest.position >= moderator.roles.highest.position && interaction.user.id !== interaction.guild?.ownerId) {
        return interaction.reply({ content: '❌ You cannot kick a user with an equal or higher role than you.', ephemeral: true });
      }

      await member.kick(reason).then(() => {
        interaction.reply({ content: `✅ Kicked ${user.tag} for: ${reason}`, ephemeral: true });
        logModAction(interaction.guild, 'Kick', interaction.user, user, reason);
      }).catch(err => {
        interaction.reply({ content: 'Failed to kick user. Check my permissions and role hierarchy.', ephemeral: true });
      });
    }

    else if (commandName === 'ban') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!user) return interaction.reply({ content: 'User not found.', ephemeral: true });

      const member = await interaction.guild?.members.fetch(user.id).catch(() => null);
      const moderator = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (member && moderator && member.roles.highest.position >= moderator.roles.highest.position && interaction.user.id !== interaction.guild?.ownerId) {
        return interaction.reply({ content: '❌ You cannot ban a user with an equal or higher role than you.', ephemeral: true });
      }

      await interaction.guild?.members.ban(user.id, { reason }).then(() => {
        interaction.reply({ content: `✅ Banned ${user.tag} for: ${reason}`, ephemeral: true });
        logModAction(interaction.guild, 'Ban', interaction.user, user, reason);
      }).catch(err => {
        interaction.reply({ content: 'Failed to ban user. Check my permissions.', ephemeral: true });
      });
    }

    else if (commandName === 'timeout') {
      const user = interaction.options.getUser('user');
      const duration = interaction.options.getInteger('duration') || 10;
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!user) return interaction.reply({ content: 'User not found.', ephemeral: true });

      const member = await interaction.guild?.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: 'User is not in the server.', ephemeral: true });

      const moderator = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (moderator && member.roles.highest.position >= moderator.roles.highest.position && interaction.user.id !== interaction.guild?.ownerId) {
        return interaction.reply({ content: '❌ You cannot timeout a user with an equal or higher role than you.', ephemeral: true });
      }

      await member.timeout(duration * 60 * 1000, reason).then(() => {
        interaction.reply({ content: `✅ Timed out ${user.tag} for ${duration} minutes. Reason: ${reason}`, ephemeral: true });
        logModAction(interaction.guild, 'Timeout', interaction.user, user, `${duration} mins: ${reason}`);
      }).catch(err => {
        interaction.reply({ content: 'Failed to timeout user.', ephemeral: true });
      });
    }

    else if (commandName === 'clear') {
      const amount = interaction.options.getInteger('amount') || 10;
      if (amount < 1 || amount > 100) return interaction.reply({ content: 'Amount must be between 1 and 100.', ephemeral: true });

      if (interaction.channel && interaction.channel.type === ChannelType.GuildText) {
        await interaction.channel.bulkDelete(amount, true).then(deleted => {
          interaction.reply({ content: `✅ Successfully deleted ${deleted.size} messages.`, ephemeral: true });
        }).catch(err => {
          interaction.reply({ content: 'Failed to delete messages. Messages older than 14 days cannot be bulk deleted.', ephemeral: true });
        });
      } else {
        interaction.reply({ content: 'This command can only be used in text channels.', ephemeral: true });
      }
    }

    else if (commandName === 'setup_tickets') {
      const embed = new EmbedBuilder()
        .setTitle('🎟️ Support Tickets')
        .setDescription('Need help? Click the button below to open a private ticket with our staff.')
        .setColor(0x5865F2);

      const ticketBtn = new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('Open Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(ticketBtn);

      await interaction.reply({ content: 'Ticket panel setup successfully.', ephemeral: true });
      if (interaction.channel && 'send' in interaction.channel) {
        await (interaction.channel as any).send({ embeds: [embed], components: [row] }).catch((err: any) => {
          console.error('Failed to send ticket panel:', err);
          interaction.followUp({ content: '❌ Failed to post panel. Make sure the bot has "Send Messages" permission in this channel!', ephemeral: true });
        });
      }
    }
  });

  // Handle Button and Modal Interactions
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    const allowed = await checkDiscordRateLimit(interaction.user.id);
    if (!allowed) {
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: '⏳ Please slow down! Wait a few seconds before interacting again.', ephemeral: true });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === 'basic_verify') {
      const modal = new ModalBuilder()
        .setCustomId('captcha_modal')
        .setTitle('🛡️ Human Verification');

      const mathInput = new TextInputBuilder()
        .setCustomId('captcha_input')
        .setLabel('What is 2 + 3? (Type the number)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2)
        .setPlaceholder('Enter your answer here...');

      const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(mathInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'captcha_modal') {
      const answer = interaction.fields.getTextInputValue('captcha_input').trim();

      if (answer !== '5') {
        return interaction.reply({ content: '❌ Incorrect answer. Please try again.', ephemeral: true });
      }

      const verifiedRole = interaction.guild?.roles.cache.find(r => r.name.toLowerCase() === 'verified');

      if (!verifiedRole) {
        return interaction.reply({ content: '⚠️ Verification system is currently misconfigured for this server. Please create a "Verified" role.', ephemeral: true });
      }

      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      if (member) {
        if (member.roles.cache.has(verifiedRole.id)) {
          return interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
        }
        await member.roles.add(verifiedRole).catch(console.error);
        await interaction.reply({ content: '✅ You have been verified successfully! Welcome to the community channels.', ephemeral: true });

        if (interaction.channel && 'send' in interaction.channel) {
          const publicEmbed = new EmbedBuilder()
            .setDescription(`🎉 <@${interaction.user.id}> has completed human verification and is now **Verified**!`)
            .setColor(0x00FF00);
          await (interaction.channel as any).send({ embeds: [publicEmbed] }).catch(() => null);
        }
        return;
      }
      return interaction.reply({ content: '❌ Could not verify your profile. Please try again.', ephemeral: true });
    }

    else if (interaction.isButton() && interaction.customId === 'verify_movement_wallet') {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return interaction.reply({ content: '⚠️ Verification is currently offline (Missing JWT Secret).', ephemeral: true });
      }

      const token = jwt.sign({ sub: interaction.user.id }, jwtSecret, { expiresIn: '15m' });
      const webappUrl = process.env.FRONTEND_URL || 'https://daftar.fi';
      const verifyUrl = `${webappUrl}/verify?token=${token}`;

      const embed = new EmbedBuilder()
        .setTitle('🔐 Secure Wallet Authentication')
        .setDescription(
          `You're just one step away from gaining your roles!\n\n` +
          `**1.** Click the link below to open the secure verification dashboard.\n` +
          `**2.** Connect your Movement wallet (e.g. Razor, Nightly).\n` +
          `**3.** Click **"Sign to Verify"** to prove ownership.\n\n` +
          `[👉 Authenticate & Verify Here](${verifyUrl})\n\n` +
          `*Your roles will be assigned automatically upon completion. This link expires in 15 minutes.*`
        )
        .setColor(0xD4AF37);

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (interaction.isButton() && interaction.customId === 'create_ticket') {
      if (!interaction.guild) return;

      const category = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === 'support' || c.name.toLowerCase() === 'ticket' && c.type === ChannelType.GuildCategory);
      let categoryId = category ? category.id : null;
      const expectedChannelName = `ticket-${interaction.user.username}`.toLowerCase();

      // Check if ticket already exists
      const existingTicket = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === expectedChannelName);
      if (existingTicket) {
        return interaction.reply({ content: `❌ You already have an open ticket: ${existingTicket}. Please close it before opening a new one.`, ephemeral: true });
      }

      // Find Support or Moderator role
      const supportRole = interaction.guild.roles.cache.find(r =>
        r.name.toLowerCase().includes('support') ||
        r.name.toLowerCase().includes('moderator')
      );

      try {
        const permissionOverwrites: any[] = [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          },
          {
            id: discordClient!.user!.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          }
        ];

        if (supportRole) {
          permissionOverwrites.push({
            id: supportRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
          });
        }

        const ticketChannel = await interaction.guild.channels.create({
          name: expectedChannelName,
          type: ChannelType.GuildText,
          parent: categoryId || null,
          permissionOverwrites,
        });

        const embed = new EmbedBuilder()
          .setTitle('Support Ticket')
          .setDescription(`Welcome ${interaction.user}! Please describe your issue and our staff will be with you shortly.`)
          .setColor(0x5865F2);

        const closeBtn = new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒');

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeBtn);

        await ticketChannel.send({ content: `${interaction.user} ${supportRole ? `<@&${supportRole.id}>` : ''}`, embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });
      } catch (err) {
        console.error('Error creating ticket:', err);
        await interaction.reply({ content: '❌ Failed to create ticket. Please check my permissions.', ephemeral: true });
      }
    }

    else if (interaction.isButton() && interaction.customId === 'close_ticket') {
      await interaction.reply({ content: 'Saving transcript and closing ticket in 5 seconds...' });

      try {
        if (interaction.channel && 'messages' in interaction.channel) {
          const messages = await (interaction.channel as any).messages.fetch({ limit: 100 });
          const transcript = messages.reverse().map((m: any) => `${m.createdAt.toISOString()} - ${m.author.tag}: ${m.content}`).join('\n');
          const buffer = Buffer.from(transcript, 'utf-8');
          const channelName = (interaction.channel as any)?.name || 'ticket';
          const attachment = new AttachmentBuilder(buffer, { name: `${channelName}-transcript.txt` });

          // Extract original user ID from channel name (ticket-username)
          // Wait, we don't have the user ID easily unless we find the first message or use channel topic.
          // Let's find the first message to get the user who opened it.
          const firstMessage = messages.find((m: any) => m.author.id === discordClient!.user!.id && m.content.includes('<@'));
          let ticketCreatorId = null;
          if (firstMessage) {
            const match = firstMessage.content.match(/<@!?(\d+)>/);
            if (match) ticketCreatorId = match[1];
          }

          if (ticketCreatorId && interaction.guild) {
            const member = await interaction.guild.members.fetch(ticketCreatorId).catch(() => null);
            if (member) {
              await member.send({
                content: `🎫 Your ticket **${channelName}** has been closed. Here is your transcript for your records.`,
                files: [attachment]
              }).catch(() => console.log('Could not DM transcript to user.'));
            }
          }

          if (interaction.guild) {
            const modlogChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === 'modlogs' && c.type === ChannelType.GuildText) as TextChannel | undefined;
            if (modlogChannel && 'send' in modlogChannel) {
              await modlogChannel.send({
                content: `🎫 Transcript for closed ticket: \`${channelName}\``,
                files: [attachment]
              }).catch(console.error);
            }
          }
        }
      } catch (err) {
        console.error('Failed to save transcript:', err);
      }

      setTimeout(async () => {
        if (interaction.channel && 'delete' in interaction.channel) {
          await interaction.channel.delete().catch(console.error);
        }
      }, 5000);
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
