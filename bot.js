const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits: PF } = require('discord.js');
const fs = require('fs'), path = require('path');

module.exports = ({ keys, fs19 }) => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],   // permite .login também por DM
  });
  const p = n => Math.round((n || 0) * 100) + '%';
  const money = n => '$' + Math.round(n || 0).toLocaleString('pt-BR');
  const EPH = 64;

  const cmds = [
    new SlashCommandBuilder().setName('fazenda').setDescription('Resumo da fazenda'),
    new SlashCommandBuilder().setName('veiculos').setDescription('Veículos e status')
      .addIntegerOption(o => o.setName('pagina').setDescription('Página').setMinValue(1)),
    new SlashCommandBuilder().setName('veiculo').setDescription('Detalhes de um veículo')
      .addStringOption(o => o.setName('nome').setDescription('Nome (ou parte)').setRequired(true)),
    new SlashCommandBuilder().setName('mod').setDescription('Envia um mod (.zip) para a pasta mods')
      .addAttachmentOption(o => o.setName('arquivo').setDescription('Arquivo .zip do mod').setRequired(true)),
    new SlashCommandBuilder().setName('mods').setDescription('Mods instalados'),
    new SlashCommandBuilder().setName('painel').setDescription('Abre (ou recria) o seu painel no canal privado'),
    new SlashCommandBuilder().setName('equipamentos').setDescription('Equipamentos, função e trator recomendado')
      .addIntegerOption(o => o.setName('pagina').setDescription('Página').setMinValue(1)),
    new SlashCommandBuilder().setName('genkey').setDescription('(dono) Gera uma key')
      .addIntegerOption(o => o.setName('dias').setDescription('Validade em dias (0 = sem limite)')),
    new SlashCommandBuilder().setName('resetkey').setDescription('(dono) Libera a key para outro PC/conta')
      .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
    new SlashCommandBuilder().setName('revogar').setDescription('(dono) Revoga uma key')
      .addStringOption(o => o.setName('key').setDescription('Key').setRequired(true)),
  ].map(c => c.toJSON());

  client.once('ready', async () => {
    await client.application.commands.set(cmds, process.env.GUILD_ID);
    console.log('Bot online como', client.user.tag);
  });

  /* ---------- canal privado + painel ---------- */
  const CH_FILE = path.join(require('./paths').DATA_DIR, 'channels.json');
  let chans = {};   // discordId -> channelId
  try { chans = JSON.parse(fs.readFileSync(CH_FILE, 'utf8')); } catch {}
  const saveChans = () => { fs.mkdirSync(path.dirname(CH_FILE), { recursive: true }); fs.writeFileSync(CH_FILE, JSON.stringify(chans)); };
  const GREEN = 0x4caf50;
  const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

  const panelMsg = user => ({
    embeds: [new EmbedBuilder().setColor(GREEN).setTitle('Painel da Fazenda')
      .setDescription(`Bem-vindo, ${user}! Este canal é só seu. Use os botões ou os comandos \`/\` aqui.\n\n` +
        '**Fazenda** saldo e resumo\n**Veículos** status de cada veículo\n**Equipamentos** função e trator recomendado\n' +
        '**Mods** mods instalados\n**Atualizar** lê o save de novo\n**Enviar mod** arraste um `.zip` aqui no canal\n**Sair** desvincula a key e apaga este canal')],
    components: [
      new ActionRowBuilder().addComponents(btn('pn:fazenda', 'Fazenda', ButtonStyle.Primary), btn('pn:veic:0', 'Veículos'), btn('pn:equip:0', 'Equipamentos'), btn('pn:mods', 'Mods')),
      new ActionRowBuilder().addComponents(btn('pn:sync', 'Atualizar dados', ButtonStyle.Success), btn('pn:mod', 'Enviar mod'), btn('pn:sair', 'Sair', ButtonStyle.Danger)),
    ],
  });

  async function openPrivate(guild, user) {
    let ch = chans[user.id] ? await guild.channels.fetch(chans[user.id]).catch(() => null) : null;
    const fresh = !ch;
    if (!ch) {
      const name = ('fazenda-' + user.username).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90);
      const mine = [PF.ViewChannel, PF.SendMessages, PF.ReadMessageHistory, PF.AttachFiles, PF.EmbedLinks];
      ch = await guild.channels.create({
        name, type: ChannelType.GuildText, parent: process.env.CATEGORY_ID || null,
        topic: `Canal privado de ${user.username} - FS19 Hub`,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PF.ViewChannel] },
          { id: user.id, allow: [...mine, PF.UseApplicationCommands] },
          { id: client.user.id, allow: [...mine, PF.ManageChannels, PF.ManageMessages] },
        ],
      });
      chans[user.id] = ch.id; saveChans();
    }
    const msg = await ch.send(panelMsg(user));
    if (fresh) msg.pin().catch(() => {});
    return ch;
  }

  const farmEmbed = () => {
    const d = fs19.getState(), v = d.vehicles, n = v.length || 1;
    return new EmbedBuilder().setColor(GREEN).setTitle(d.farm.name).addFields(
      { name: 'Saldo', value: money(d.farm.money), inline: true },
      { name: 'Empréstimo', value: money(d.farm.loan), inline: true },
      { name: 'Veículos', value: `${v.length} (${v.filter(x => x.motorized).length} motorizados)`, inline: true },
      { name: 'Dano médio', value: p(v.reduce((a, x) => a + x.damage, 0) / n), inline: true },
      { name: 'Sujeira média', value: p(v.reduce((a, x) => a + x.dirt, 0) / n), inline: true },
      { name: 'Diesel total', value: `${v.reduce((a, x) => a + x.fuel, 0).toLocaleString('pt-BR')} L`, inline: true },
      { name: 'Mods instalados', value: String(d.mods.length), inline: true },
    ).setTimestamp(d.updatedAt);
  };
  const pager = (kind, pg, pages) => new ActionRowBuilder().addComponents(
    btn(`pn:${kind}p:${pg - 1}`, 'Anterior').setDisabled(pg <= 0), btn(`pn:${kind}p:${pg + 1}`, 'Próxima').setDisabled(pg >= pages - 1));
  function vehPage(pg) {
    const v = fs19.getState().vehicles, per = 8, pages = Math.max(1, Math.ceil(v.length / per));
    pg = Math.min(Math.max(0, pg), pages - 1);
    const lines = v.slice(pg * per, pg * per + per).map(x => `**${x.name}** — dano ${p(x.damage)} · sujeira ${p(x.dirt)} · diesel ${x.fuel} L · ${x.hours} h`);
    return { embeds: [new EmbedBuilder().setColor(GREEN).setTitle(`Veículos (${v.length})`).setDescription(lines.join('\n') || 'Nenhum veículo.').setFooter({ text: `Página ${pg + 1}/${pages}` })], components: [pager('veic', pg, pages)] };
  }
  function equipPage(pg) {
    const v = [...fs19.getState().vehicles].sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
    const per = 5, pages = Math.max(1, Math.ceil(v.length / per));
    pg = Math.min(Math.max(0, pg), pages - 1);
    const rec = x => x.isTractor ? `Potência estimada ~${x.hpEst} cv`
      : (x.motorized || x.selfPropelled) ? 'Autopropelido, não precisa de trator'
      : x.rec?.ok ? `Trator recomendado: ${x.rec.best.map(b => b.name).join(', ')}` : (x.rec?.text || '');
    const lines = v.slice(pg * per, pg * per + per).map(x => `**${x.name}** · ${x.category || 'Implemento'}\n${x.fn || ''}\n${rec(x)}`);
    return { embeds: [new EmbedBuilder().setColor(GREEN).setTitle('Equipamentos').setDescription(lines.join('\n\n') || 'Nada encontrado.').setFooter({ text: `Página ${pg + 1}/${pages} · potência dos tratores estimada pelo valor` })], components: [pager('equip', pg, pages)] };
  }
  const modsText = () => { const m = fs19.listMods(); return m.length ? '```\n' + m.map(x => `${x.name} (${(x.size / 1048576).toFixed(1)} MB)`).join('\n').slice(0, 1900) + '\n```' : 'Nenhum mod encontrado.'; };

  // .login KEY: vincula, cria o canal privado + painel, avisa por DM
  client.on('messageCreate', async m => {
    if (m.author.bot) return;

    // arrastar um .zip no canal privado instala o mod
    if (m.guild && chans[m.author.id] === m.channelId && m.attachments.size && keys.byDiscord(m.author.id)) {
      for (const att of m.attachments.values()) {
        const name = fs19.safeModName(att.name); if (!name) continue;
        try {
          const buf = Buffer.from(await (await fetch(att.url)).arrayBuffer());
          fs19.saveMod(name, buf);
          await m.reply(`Mod **${name}** enviado para a pasta mods (${(buf.length / 1048576).toFixed(1)} MB). Reinicie o jogo/servidor para carregar.`);
        } catch (e) { await m.reply('Falha ao salvar o mod: ' + e.message).catch(() => {}); }
      }
      return;
    }

    if (!m.content.toLowerCase().startsWith('.login')) return;
    const key = m.content.split(/\s+/)[1];
    if (m.guild) m.delete().catch(() => {});   // não deixa a key à mostra
    const say = async txt => { const out = await m.channel.send(txt).catch(() => null); if (m.guild && out) setTimeout(() => out.delete().catch(() => {}), 15000); };
    if (!key) return say(`${m.author}, use: .login SUA_KEY`);
    const r = keys.linkDiscord(key, m.author.id);
    if (!r.ok) return say(`${m.author}, ${r.error}.`);

    let ch;
    try {
      const guild = m.guild || await client.guilds.fetch(process.env.GUILD_ID);
      ch = await openPrivate(guild, m.author);
    } catch (e) {
      console.error('[canal privado]', e.message);
      return say(`${m.author}, login feito, mas não consegui criar o seu canal privado. Dê ao bot a permissão **Gerenciar Canais**. Os comandos / já estão liberados.`);
    }
    await say(`${m.author}, login concluído com sucesso! Vá para o seu canal privado: ${ch}`);
    const dmOk = await m.author.send({ embeds: [new EmbedBuilder().setColor(GREEN).setTitle('Login concluído com sucesso')
      .setDescription(`Sua key foi vinculada e o seu canal privado está pronto: ${ch}\nServidor: **${ch.guild.name}**`)] }).then(() => true).catch(() => false);
    if (!dmOk) ch.send('Não consegui te enviar a DM de confirmação (suas mensagens diretas estão fechadas).').catch(() => {});
  });

  // botões do painel
  async function onPanel(i) {
    if (!keys.byDiscord(i.user.id)) return i.reply({ content: 'Faça login primeiro: `.login SUA_KEY`', flags: EPH });
    if (chans[i.user.id] !== i.channelId) return i.reply({ content: 'Este painel é de outro usuário.', flags: EPH });
    const [, act, arg] = i.customId.split(':');
    try {
      switch (act) {
        case 'fazenda': return i.reply({ embeds: [farmEmbed()] });
        case 'veic': return i.reply(vehPage(+arg || 0));
        case 'veicp': return i.update(vehPage(+arg));
        case 'equip': return i.reply(equipPage(+arg || 0));
        case 'equipp': return i.update(equipPage(+arg));
        case 'mods': return i.reply(modsText());
        case 'sync': { fs19.getState(true); return i.reply({ content: `Dados atualizados às ${new Date().toLocaleTimeString('pt-BR')}.`, embeds: [farmEmbed()] }); }
        case 'mod': return i.reply({ content: 'Arraste o arquivo `.zip` do mod aqui no canal (ou use `/mod`). Ele vai direto para a pasta mods.', flags: EPH });
        case 'sair': {
          keys.unlinkDiscord(i.user.id); delete chans[i.user.id]; saveChans();
          await i.reply({ content: 'Key desvinculada. Este canal será apagado em 5 segundos.', flags: EPH });
          i.user.send('Você saiu do FS19 Hub. Para entrar de novo use `.login SUA_KEY`.').catch(() => {});
          return void setTimeout(() => i.channel.delete().catch(() => {}), 5000);
        }
      }
    } catch (err) {
      console.error(err);
      i.reply({ content: 'Erro: ' + err.message, flags: EPH }).catch(() => {});
    }
  }

  client.on('interactionCreate', async i => {
    if (i.isButton() && i.customId.startsWith('pn:')) return onPanel(i);
    if (!i.isChatInputCommand()) return;
    const ownerCmds = ['genkey', 'resetkey', 'revogar'];
    if (ownerCmds.includes(i.commandName)) {
      if (i.user.id !== process.env.OWNER_ID) return i.reply({ content: 'Só o dono pode usar este comando.', flags: EPH });
    } else if (!keys.byDiscord(i.user.id)) {
      return i.reply({ content: 'Faça login primeiro: `.login SUA_KEY`', flags: EPH });
    }
    try {
      switch (i.commandName) {
        case 'genkey': {
          const key = keys.create(i.options.getInteger('dias') || 0);
          return i.reply({ content: `Key gerada: \`${key}\``, flags: EPH });
        }
        case 'resetkey': return i.reply({ content: keys.reset(i.options.getString('key')) ? 'Key liberada.' : 'Key não encontrada.', flags: EPH });
        case 'revogar': return i.reply({ content: keys.revoke(i.options.getString('key')) ? 'Key revogada.' : 'Key não encontrada.', flags: EPH });

        case 'painel': {
          await i.deferReply({ flags: EPH });
          const ch = await openPrivate(i.guild, i.user);
          return i.editReply(`Seu painel está em ${ch}`);
        }
        case 'equipamentos': return i.reply(equipPage((i.options.getInteger('pagina') || 1) - 1));

        case 'fazenda': {
          const d = fs19.getState(), v = d.vehicles, n = v.length || 1;
          const e = new EmbedBuilder().setColor(0x4caf50).setTitle(d.farm.name)
            .addFields(
              { name: 'Saldo', value: money(d.farm.money), inline: true },
              { name: 'Empréstimo', value: money(d.farm.loan), inline: true },
              { name: 'Veículos', value: `${v.length} (${v.filter(x => x.motorized).length} motorizados)`, inline: true },
              { name: 'Dano médio', value: p(v.reduce((a, x) => a + x.damage, 0) / n), inline: true },
              { name: 'Sujeira média', value: p(v.reduce((a, x) => a + x.dirt, 0) / n), inline: true },
              { name: 'Diesel total', value: `${v.reduce((a, x) => a + x.fuel, 0).toLocaleString('pt-BR')} L`, inline: true },
              { name: 'Mods instalados', value: String(d.mods.length), inline: true },
            ).setTimestamp(d.updatedAt);
          return i.reply({ embeds: [e] });
        }
        case 'veiculos': {
          const v = fs19.getState().vehicles, per = 10;
          const pages = Math.max(1, Math.ceil(v.length / per));
          const pg = Math.min(i.options.getInteger('pagina') || 1, pages);
          const lines = v.slice((pg - 1) * per, pg * per).map(x =>
            `**${x.name}** — dano ${p(x.damage)} · sujeira ${p(x.dirt)} · diesel ${x.fuel} L · ${x.hours} h`);
          const e = new EmbedBuilder().setColor(0x4caf50).setTitle(`Veículos (${v.length})`)
            .setDescription(lines.join('\n') || 'Nenhum veículo.').setFooter({ text: `Página ${pg}/${pages}` });
          return i.reply({ embeds: [e] });
        }
        case 'veiculo': {
          const q = i.options.getString('nome').toLowerCase();
          const x = fs19.getState().vehicles.find(a => a.name.toLowerCase().includes(q));
          if (!x) return i.reply({ content: 'Não achei esse veículo.', flags: EPH });
          const e = new EmbedBuilder().setColor(0x4caf50).setTitle(x.name)
            .addFields(
              { name: 'Tipo', value: x.motorized ? 'Motorizado' : 'Implemento', inline: true },
              { name: 'Horas de uso', value: `${x.hours} h`, inline: true },
              { name: 'Diesel', value: `${x.fuel} L`, inline: true },
              { name: 'Dano', value: p(x.damage), inline: true },
              { name: 'Desgaste', value: p(x.wear), inline: true },
              { name: 'Sujeira', value: p(x.dirt), inline: true },
              { name: 'Valor', value: money(x.price), inline: true },
              { name: 'Situação', value: x.state, inline: true },
              ...(x.mod ? [{ name: 'Mod', value: x.mod, inline: true }] : []),
            );
          return i.reply({ embeds: [e] });
        }
        case 'mods': {
          const m = fs19.listMods();
          const txt = m.map(x => `${x.name} (${(x.size / 1048576).toFixed(1)} MB)`).join('\n');
          return i.reply({ content: m.length ? '```\n' + txt.slice(0, 1900) + '\n```' : 'Nenhum mod encontrado.', flags: EPH });
        }
        case 'mod': {
          const att = i.options.getAttachment('arquivo');
          const name = fs19.safeModName(att.name);
          if (!name) return i.reply({ content: 'Envie um arquivo .zip válido.', flags: EPH });
          await i.deferReply({ flags: EPH });
          const buf = Buffer.from(await (await fetch(att.url)).arrayBuffer());
          fs19.saveMod(name, buf);
          return i.editReply(`Mod **${name}** enviado para a pasta mods (${(buf.length / 1048576).toFixed(1)} MB). Reinicie o jogo/servidor para carregar.`);
        }
      }
    } catch (err) {
      console.error(err);
      const msg = { content: 'Erro: ' + err.message, flags: EPH };
      i.deferred || i.replied ? i.editReply(msg).catch(() => {}) : i.reply(msg).catch(() => {});
    }
  });

  client.login(process.env.DISCORD_TOKEN).catch(e => console.error('[aviso] Token do Discord inválido ou sem permissão (' + e.message + '). A API continua no ar.'));
};
