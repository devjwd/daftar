import { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ApplicationCommandOptionType, ChannelType, TextChannel, AttachmentBuilder } from 'discord.js';
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

        const embed = new EmbedBuilder()
          .setTitle(`👤 ${profile?.username || 'Daftar User'}'s Profile`)
          .setDescription(profile?.bio || '*No bio provided.*')
          .addFields(
            { name: 'Level', value: `${profile?.current_level || 1} 🌟`, inline: true },
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
          'To gain full access to the server channels and receive your exclusive roles, please verify your Movement wallet.\n\n' +
          '**Benefits of Verification:**\n' +
          '• Unlock all community channels\n' +
          '• Display your `Verified` badge\n' +
          '• Gain `Pro` roles automatically if you hold an active subscription\n\n' +
          '*Click the button below to start the secure verification process.*'
        )
        .setColor(0xD4AF37)
        .setFooter({ text: 'Powered by Daftar', iconURL: discordClient?.user?.displayAvatarURL() });

      const verifyButton = new ButtonBuilder()
        .setCustomId('verify_movement_wallet')
        .setLabel('Verify Wallet')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton);

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

  // Handle Button Interactions
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId === 'verify_movement_wallet') {
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

    else if (interaction.customId === 'create_ticket') {
      if (!interaction.guild) return;
      
      const category = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === 'ticket' && c.type === ChannelType.GuildCategory);
      const categoryId = category ? category.id : null;
      
      try {
        const ticketChannel = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}`,
          type: ChannelType.GuildText,
          parent: categoryId || null,
          permissionOverwrites: [
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
          ],
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

        await ticketChannel.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });
      } catch (err) {
        console.error('Error creating ticket:', err);
        await interaction.reply({ content: '❌ Failed to create ticket. Please check my permissions.', ephemeral: true });
      }
    }

    else if (interaction.customId === 'close_ticket') {
      await interaction.reply({ content: 'Saving transcript and closing ticket in 5 seconds...' });
      
      try {
        if (interaction.channel && 'messages' in interaction.channel) {
          const messages = await (interaction.channel as any).messages.fetch({ limit: 100 });
          const transcript = messages.reverse().map((m: any) => `${m.createdAt.toISOString()} - ${m.author.tag}: ${m.content}`).join('\n');
          
          if (interaction.guild) {
            const modlogChannel = interaction.guild.channels.cache.find(c => c.name.toLowerCase() === 'modlogs' && c.type === ChannelType.GuildText) as TextChannel | undefined;
            if (modlogChannel && 'send' in modlogChannel) {
              const buffer = Buffer.from(transcript, 'utf-8');
              const channelName = (interaction.channel as any)?.name || 'ticket';
              const attachment = new AttachmentBuilder(buffer, { name: `${channelName}-transcript.txt` });
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
