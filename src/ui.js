import { CONFIG } from './config.js';
import { loadoutCost, canStep, neighbors, unfoundCount, shadowMarks, sidePower, visibleCells } from './engine.js';
import { cellBox, mapMarkup } from './board.js';
import { bindDrag } from './dnd.js';
import { cellNote, endText, formatStrength, resultText } from './timeline.js';

let timers = [];

export function clearTimers() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

export function formatMoney(value) {
  const sign = value < 0 ? '−' : '';
  const body = String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  return `${sign}${body}\u00A0$`;
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shownMoney(state) {
  if (state.bill && !state.settled) return state.ledger.wallets.attack - state.bill.attack;
  return state.wallets.attack;
}

function clockText(state) {
  if (!state.deadline) return '';
  const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function clockHtml(state) {
  const text = clockText(state);
  if (!text) return '';
  const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  return `<span class="clock${left <= 10 ? ' hot' : ''}" data-clock>${text}</span>`;
}
function rulesBlock() {
  const rifle = CONFIG.weapons.rifle;
  const smg = CONFIG.weapons.smg;
  const hold = formatStrength(CONFIG.rules.holdMultiplier);
  return `
    <details>
      <summary>Правила</summary>
      <ul>
        <li>Матч до\u00A0${CONFIG.rules.winsNeeded} побед и\u00A0не больше ${CONFIG.rules.maxRounds} раундов. В\u00A0раунде ${CONFIG.rules.movesPerRound} хода. Обе стороны ходят одновременно и\u00A0вслепую. На\u00A0закуп ${CONFIG.ui.buySeconds} секунд, на\u00A0ход ${CONFIG.ui.moveSeconds}. Время вышло\u00A0— уходит то, что уже стоит.</li>
        <li>Шаг только в\u00A0соседнюю клетку или на\u00A0месте. Вы начинаете на\u00A0Т-спавне, бот на\u00A0КТ-спавне. До\u00A0плента вам три шага, защите два. Если бежите навстречу по\u00A0одной связи\u00A0— стычка на\u00A0дороге, без множителя стойки; выжившие доходят.</li>
        <li>Пистолет даёт 1, ${esc(smg.name)} ${smg.strength}, ${esc(rifle.name)} ${rifle.strength}. ${esc(CONFIG.armor.name)} силы не даёт и\u00A0снимает одну смерть за\u00A0раунд.</li>
        <li>Проходные клетки с\u00A0самого начала у\u00A0защиты, пленты ваши. Множитель ×${hold} только у\u00A0того, кто стоит в\u00A0своей клетке, а\u00A0не пришёл. Где встретились, слабые гибнут все. У\u00A0сильных, если их двое и\u00A0больше, погибает один. Кто выиграл в\u00A0одиночку, остаётся жив. При равенстве клетка остаётся у\u00A0хозяина, и\u00A0каждая сторона теряет одного. Отстоитесь в\u00A0чужой клетке одни\u00A0— со\u00A0следующего хода она ваша.</li>
        <li>В\u00A0клетке стреляют трое: двое в\u00A0полную силу, третий вполсилы. Остальные стоят в\u00A0проходе\u00A0— в\u00A0счёт не идут, а\u00A0в\u00A0бою гибнут первыми. Толпой в\u00A0одну клетку лучше не ходить.</li>
        <li>Бомба ставится, когда вы живы на\u00A0пленте и\u00A0защиты там нет. Потом защита может обезвредить, если займёт клетку одна. После четвёртого хода неснятая бомба\u00A0— ваш раунд. Без бомбы побеждает, у\u00A0кого больше живых. Поровну\u00A0— защита.</li>
        <li>Гранаты списываются в\u00A0начале раунда. Бросить можно любым ходом, в\u00A0свою клетку или соседнюю. Не бросили\u00A0— сгорели. Дымовая снимает ${CONFIG.utility.smoke.penalty} силы у\u00A0каждого противника в\u00A0клетке. Световая: победа без потерь, при равенстве клетка ваша.</li>
        <li>Чужих видно в\u00A0своей клетке и\u00A0в\u00A0соседних. Разбор после раунда показывает всё.</li>
      </ul>
    </details>
  `;
}

function chip(person, tokenId) {
  const raw = CONFIG.weapons[person.weapon].strength;
  const strength = person.stood ? raw * CONFIG.rules.holdMultiplier : raw;
  const drag = tokenId ? ` data-token="${esc(tokenId)}"` : '';
  const classes = ['token', person.side === 'defense' ? 'enemy' : 'own', person.alive === false ? 'dead' : '', person.stood ? 'stood' : '']
    .filter(Boolean)
    .join(' ');
  const armor = person.armor && !person.armorUsed ? ' Б' : '';
  return `<span class="${classes}"${drag}>${esc(person.name)} ${formatStrength(strength)}${armor}</span>`;
}

function ownPower(state, cellId) {
  if (!state.roundState) return 0;
  const people = state.roundState.fighters.filter((fighter) => {
    if (fighter.side !== 'attack' || !fighter.alive) return false;
    const to = state.draft.to[fighter.name] || fighter.point;
    return to === cellId;
  });
  const stayed = new Set(
    people
      .filter((fighter) => (state.draft.to[fighter.name] || fighter.point) === fighter.point)
      .map((fighter) => fighter.name),
  );
  return sidePower(people, cellId, 'attack', state.roundState.owned, 0, stayed, CONFIG);
}

function sightMove(state) {
  if (!state.roundState || state.phase === 'buy') return -1;
  if (state.phase === 'move') return state.roundState.move;
  return state.roundState.move;
}

function attackVision(state) {
  const fighters = stepOf(state)?.state?.fighters || state.roundState?.fighters;
  if (!fighters) return new Set();
  return visibleCells(fighters, 'attack', CONFIG);
}

function stepOf(state) {
  if (state.phase === 'review') return state.log[state.replayIndex] || null;
  if (state.phase === 'reveal') return state.log.at(-1) || null;
  return null;
}

function peopleInCell(state, cellId) {
  const step = stepOf(state);
  if (state.phase === 'buy') {
    if (cellId !== CONFIG.spawns.attack) return [];
    return state.draft.fighters.map((fighter, index) => ({
      html: chip({ ...fighter, side: 'attack', alive: true }, `fighter-${index}`),
    }));
  }
  if (state.phase === 'move') {
    const vision = attackVision(state);
    const chips = [];
    for (const fighter of state.roundState.fighters) {
      if (fighter.side === 'attack') {
        const to = fighter.alive ? (state.draft.to[fighter.name] || fighter.point) : fighter.point;
        if (to !== cellId) continue;
        const index = state.draft.fighters.findIndex((item) => item.name === fighter.name);
        const stood = fighter.alive && to === fighter.point && state.roundState.owned[cellId] === 'attack';
        chips.push(chip({ ...fighter, stood }, fighter.alive ? `fighter-${index}` : ''));
        continue;
      }
      if (!fighter.alive || fighter.point !== cellId) continue;
      if (!vision.has(cellId)) continue;
      chips.push(chip({ ...fighter, stood: false }, ''));
    }
    return chips.map((html) => ({ html }));
  }
  if (!step) return [];
  const truth = state.phase === 'review';
  const fight = step.fights[cellId];
  const vision = attackVision(state);
  const chips = [];
  for (const fighter of step.state.fighters) {
    if (fighter.point !== cellId) continue;
    if (fighter.side === 'defense' && !truth) {
      const seen = (fight?.contact && fight.present.some((person) => person.name === fighter.name))
        || vision.has(cellId);
      if (!seen) continue;
    }
    const card = fight?.present?.find((person) => person.name === fighter.name);
    const stood = Boolean(card?.stood && fight?.owned === fighter.side);
    chips.push(chip({ ...fighter, stood }, ''));
  }
  return chips.map((html) => ({ html }));
}

function powerLine(state, cellId) {
  const step = stepOf(state);
  if (!step) {
    const power = state.phase === 'buy' ? 0 : ownPower(state, cellId);
    if (!power) return '';
    return `<p class="cell-power">${formatStrength(power)}</p>`;
  }
  const fight = step.fights[cellId];
  const truth = state.phase === 'review';
  if (!fight) return '';
  if (truth && (fight.attackCount || fight.defenseCount)) {
    return `<p class="cell-power">${formatStrength(fight.attackFinal)} <span>против</span> ${formatStrength(fight.defenseFinal)}</p>`;
  }
  if (fight.contact) {
    return `<p class="cell-power">${formatStrength(fight.attackFinal)} <span>против</span> ${formatStrength(fight.defenseFinal)}</p>`;
  }
  if (fight.attackCount) return `<p class="cell-power">${formatStrength(fight.attackFinal)}</p>`;
  return '';
}

function ownerLine(state, cellId) {
  const owned = (stepOf(state)?.state || state.roundState)?.owned?.[cellId]
    || CONFIG.map.cells[cellId].owner;
  if (!owned) return '';
  const hold = formatStrength(CONFIG.rules.holdMultiplier);
  const text = owned === 'attack' ? `ваша ×${hold}` : `защита ×${hold}`;
  return `<p class="cell-own ${owned}">${text}</p>`;
}

function bombHere(state, cellId) {
  const round = stepOf(state)?.state || state.roundState;
  return round?.bomb?.point === cellId && !round.defused;
}

function clashesFor(step, cellId) {
  if (!step) return [];
  return Object.values(step.fights).filter((fight) => (
    fight.clash && fight.contact && fight.endpoints?.includes(cellId)
  ));
}

function cellsMarkup(state) {
  return CONFIG.cellOrder.map((cellId) => {
    const box = cellBox(cellId);
    const cell = CONFIG.map.cells[cellId];
    const step = stepOf(state);
    const fight = step?.fights[cellId];
    const road = clashesFor(step, cellId);
    const hot = fight?.contact || road.length ? ' hot' : '';
    const plant = cell.plant ? ' plant' : '';
    const bomb = bombHere(state, cellId) ? ' bombed' : '';
    const people = peopleInCell(state, cellId).map((item) => item.html).join('');
    const shadows = state.phase === 'review' ? [] : shadowMarks(
      state.roundState?.fighters || [],
      state.memory || {},
      'attack',
      sightMove(state),
    ).filter((mark) => mark.point === cellId);
    const shadow = shadows.map((mark) => `<p class="shadow">${esc(mark.name)}, ход\u00A0${mark.move}</p>`).join('');
    const thrown = state.phase === 'move'
      ? (state.draft.throws || []).filter((item) => item.point === cellId).map((item) => CONFIG.utility[state.roundState.stock.attack[item.index]].name)
      : [];
    const throwLine = thrown.length ? `<p class="cell-throw">${esc(thrown.join(', '))}</p>` : '';
    const note = step ? cellNote(cellId, step, state.phase === 'review') : '';
    const showFight = state.phase === 'review' || fight?.contact;
    const result = step && showFight ? resultText(fight) : '';
    const roadLine = step && (state.phase === 'review' || road.length)
      ? road.map((item) => resultText(item)).filter(Boolean).map((text) => `<p class="cell-result">${esc(text)}</p>`).join('')
      : '';
    const bombLine = bombHere(state, cellId) ? '<p class="cell-bomb">Бомба</p>' : '';
    return `
      <div class="cell${hot}${plant}${bomb}" data-zone="${esc(cellId)}" style="left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%">
        <p class="cell-label">${esc(cell.label)}</p>
        ${ownerLine(state, cellId)}
        ${powerLine(state, cellId)}
        <div class="cell-people">${people}</div>
        ${shadow}
        ${throwLine}
        ${bombLine}
        ${result ? `<p class="cell-result">${esc(result)}</p>` : ''}
        ${roadLine}
        ${note ? `<p class="cell-note">${esc(note)}</p>` : ''}
      </div>
    `;
  }).join('');
}

function weaponPicker(state) {
  if (state.phase !== 'buy' || !state.draft.selected?.startsWith('fighter-')) {
    return '<p class="hint">Нажмите своего, чтобы выбрать оружие и\u00A0броник.</p>';
  }
  const index = Number(state.draft.selected.slice('fighter-'.length));
  const fighter = state.draft.fighters[index];
  const guns = CONFIG.weaponOrder.map((id) => {
    const weapon = CONFIG.weapons[id];
    const next = state.draft.fighters.map((item, itemIndex) => (
      itemIndex === index ? { ...item, weapon: id } : item
    ));
    const short = loadoutCost(next, state.draft.stock, CONFIG) - state.wallets.attack;
    const current = fighter.weapon === id ? ' current' : '';
    const note = short > 0 ? `, не хватает ${formatMoney(short)}` : '';
    return `<button type="button" class="weapon${current}" data-weapon="${esc(id)}"${short > 0 ? ' disabled' : ''}>${esc(weapon.name)} · ${formatMoney(weapon.cost)} · сила ${weapon.strength}${note}</button>`;
  }).join('');
  const armored = state.draft.fighters.map((item, itemIndex) => (
    itemIndex === index ? { ...item, armor: !fighter.armor } : item
  ));
  const armorShort = loadoutCost(armored, state.draft.stock, CONFIG) - state.wallets.attack;
  const armorOff = !fighter.armor && armorShort > 0;
  return `
    <p class="picker-name">${esc(fighter.name)}</p>
    ${guns}
    <button type="button" class="weapon${fighter.armor ? ' current' : ''}" data-armor="1"${armorOff ? ' disabled' : ''}>${esc(CONFIG.armor.name)} · ${formatMoney(CONFIG.armor.cost)} · снимает одну смерть${armorOff ? `, не хватает ${formatMoney(armorShort)}` : ''}</button>
  `;
}

function grenadeButtons(state) {
  if (state.phase !== 'buy') return '';
  return CONFIG.utilityOrder.map((id) => {
    const item = CONFIG.utility[id];
    const next = state.draft.stock.concat(id);
    const full = state.draft.stock.length >= CONFIG.rules.maxUtility;
    const short = loadoutCost(state.draft.fighters, next, CONFIG) - state.wallets.attack;
    const disabled = full || short > 0 ? ' disabled' : '';
    const why = full ? ' · лимит' : short > 0 ? ` · не хватает ${formatMoney(short)}` : '';
    return `<button type="button" data-buy="${esc(id)}"${disabled}>${esc(item.name)} · ${formatMoney(item.cost)}${why}</button>`;
  }).join('');
}

function tray(state) {
  if (state.phase === 'buy') {
    const chips = state.draft.stock.map((type, index) => (
      `<span class="token grenade" data-token="util-${index}">${esc(CONFIG.utility[type].name)}<small>сгорит, если не бросить</small><button type="button" data-stop data-remove="${index}">убрать</button></span>`
    )).join('');
    return `<div class="tray" data-zone="hand">${chips}</div>`;
  }
  if (state.phase !== 'move' || !state.roundState) return '';
  const chips = state.roundState.stock.attack.map((type, index) => {
    const assigned = state.draft.throws.find((item) => item.index === index);
    if (assigned?.point) return '';
    return `<span class="token grenade" data-token="util-${index}">${esc(CONFIG.utility[type].name)}<small>в свою клетку или соседнюю</small></span>`;
  }).join('');
  if (!chips) return '';
  return `<div class="tray" data-zone="hand">${chips}</div>`;
}

function panel(state) {
  const money = shownMoney(state);
  if (state.phase === 'buy') {
    const cost = loadoutCost(state.draft.fighters, state.draft.stock, CONFIG);
    const ready = cost <= state.wallets.attack;
    return `
      <section class="panel">
        <h2>Закуп</h2>
        <p class="hint">На\u00A0закуп ${CONFIG.ui.buySeconds}\u00A0секунд. Гранаты списываются сейчас. Бросить можно на\u00A0любом из\u00A0четырёх ходов. Не бросили\u00A0— сгорели.</p>
        ${weaponPicker(state)}
        <div class="actions">${grenadeButtons(state)}</div>
        <p class="cost-line ${ready ? 'ok' : 'bad'}">Набор ${formatMoney(cost)}. Останется ${formatMoney(state.wallets.attack - cost)}.</p>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
        <button type="button" id="commit"${ready ? '' : ' disabled'}>Начать раунд${clockHtml(state)}</button>
        ${rulesBlock()}
      </section>
    `;
  }
  if (state.phase === 'move') {
    const move = state.roundState.move + 1;
    const missing = unfoundCount(state.roundState, state.memory, 'attack', sightMove(state));
    return `
      <section class="panel">
        <h2>Ход ${move}</h2>
        <p class="hint">Перетащите живого в\u00A0соседнюю клетку или оставьте где стоит. Бот ходит одновременно и\u00A0вашей расстановки не видит.</p>
        <p class="unfound">Не найдено: ${missing}</p>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
        <button type="button" id="commit">Сделать ход${clockHtml(state)}</button>
        <p class="hint">Деньги набора: ${formatMoney(state.bill.attack)}. Сейчас ${formatMoney(money)}.</p>
        ${rulesBlock()}
      </section>
    `;
  }
  if (state.phase === 'reveal') {
    const step = state.log.at(-1);
    const over = Boolean(state.roundState.winner);
    const missing = unfoundCount(state.roundState, state.memory, 'attack', sightMove(state));
    return `
      <section class="panel">
        <h2>Ход ${step.move}</h2>
        <p class="hint">${esc(over ? endText(state.roundState) : 'Чужих видно у\u00A0себя и\u00A0в\u00A0соседних клетках. Контакт подсвечен.')}</p>
        <p class="unfound">Не найдено: ${missing}</p>
        <button type="button" id="continue">${over ? 'Как было на\u00A0самом деле' : `Ход ${step.move + 1}`}</button>
        ${rulesBlock()}
      </section>
    `;
  }
  const step = state.log[state.replayIndex];
  const playLabel = state.playing ? 'Пауза' : 'Дальше само';
  const nextLabel = state.matchWinner ? 'Ещё матч' : 'Следующий раунд';
  const banner = state.matchWinner
    ? `<p class="result-banner ${esc(state.matchWinner)}">${state.matchWinner === 'attack' ? 'Победа атаки' : state.matchWinner === 'defense' ? 'Победа защиты' : 'Ничья'}</p>`
    : '';
  return `
    <section class="panel">
      <h2>Ход ${step ? step.move : 1}, как было</h2>
      <p class="hint">${esc(endText(state.roundState))}</p>
      <div class="actions transport">
        <button type="button" id="replay-start" class="secondary">Сначала</button>
        <button type="button" id="replay-back" class="secondary">Назад</button>
        <button type="button" id="replay-play">${playLabel}</button>
        <button type="button" id="replay-forward" class="secondary">Вперёд</button>
      </div>
      ${banner}
      <div class="actions"><button type="button" id="next">${nextLabel}</button></div>
      ${rulesBlock()}
    </section>
  `;
}

function scoreboard(state) {
  const botWeapon = state.bot ? CONFIG.weapons[state.bot.weapon].name : 'ещё не закупился';
  return `
    <header class="top">
      <div>
        <p class="eyebrow">тестовая сборка · четыре хода</p>
        <h1>Dust2</h1>
      </div>
      <div class="wallet">
        <p class="muted">Ваши деньги</p>
        <strong>${formatMoney(shownMoney(state))}</strong>
        ${clockHtml(state)}
      </div>
    </header>
    <section class="scoreboard">
      <div><p class="role">Вы · атака</p><p class="num">${state.score.attack}</p></div>
      <p class="round">Раунд ${state.round}</p>
      <div><p class="role">Бот · защита</p><p class="num">${state.score.defense}</p><p class="meta">${esc(botWeapon)}</p></div>
    </section>
  `;
}

export function render(state, actions) {
  clearTimers();
  const missing = state.roundState
    ? unfoundCount(state.roundState, state.memory, 'attack', sightMove(state))
    : CONFIG.rules.defenseFighters;
  const app = document.querySelector('#app');
  app.innerHTML = `
    ${scoreboard(state)}
    <div class="stage">
      <div>
        ${state.phase === 'review' ? '' : `<p class="unfound map-unfound">Не найдено: ${state.phase === 'buy' ? CONFIG.rules.defenseFighters : missing}</p>`}
        <div id="board">
          <div class="map-frame">
            ${mapMarkup()}
            ${cellsMarkup(state)}
          </div>
          ${tray(state)}
        </div>
      </div>
      ${panel(state)}
    </div>
    <p class="foot">Тестовая сборка. Рейтинга и\u00A0ставок нет.</p>
  `;

  bindDrag(document.querySelector('#board'), {
    onTap(tokenId) {
      if (state.phase === 'buy' && tokenId.startsWith('fighter-')) actions.onSelect(tokenId);
    },
    onDrag(tokenId) {
      const zones = document.querySelectorAll('#board [data-zone]');
      for (const zone of zones) zone.classList.remove('reach');
      if (state.phase !== 'move') return;
      if (tokenId.startsWith('fighter-')) {
        const index = Number(tokenId.slice('fighter-'.length));
        const name = state.draft.fighters[index].name;
        const from = state.roundState.fighters.find((fighter) => fighter.name === name).point;
        for (const zone of zones) {
          if (zone.dataset.zone !== 'hand' && canStep(from, zone.dataset.zone)) zone.classList.add('reach');
        }
      }
      if (tokenId.startsWith('util-')) {
        const cells = new Set();
        for (const fighter of state.roundState.fighters) {
          if (fighter.side !== 'attack' || !fighter.alive) continue;
          const at = state.draft.to[fighter.name] || fighter.point;
          cells.add(at);
          for (const next of neighbors(at)) cells.add(next);
        }
        for (const zone of zones) {
          if (cells.has(zone.dataset.zone)) zone.classList.add('reach');
        }
      }
    },
    onDrop(tokenId, zone) {
      actions.onMove(tokenId, zone);
    },
    onZone() {},
  }, { threshold: CONFIG.ui.dragThreshold });

  app.querySelectorAll('[data-weapon]').forEach((button) => {
    button.addEventListener('click', () => actions.onWeapon(button.dataset.weapon));
  });
  app.querySelector('[data-armor]')?.addEventListener('click', () => actions.onArmor());
  app.querySelectorAll('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => actions.onBuyUtility(button.dataset.buy));
  });
  app.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      actions.onRemove(Number(button.dataset.remove));
    });
  });
  app.querySelector('#commit')?.addEventListener('click', () => {
    if (state.phase === 'buy') actions.onCommitBuy();
    else actions.onCommitMove();
  });
  app.querySelector('#continue')?.addEventListener('click', () => actions.onContinue());
  app.querySelector('#replay-back')?.addEventListener('click', () => actions.onReplay(state.replayIndex - 1, false));
  app.querySelector('#replay-forward')?.addEventListener('click', () => actions.onReplay(state.replayIndex + 1, false));
  app.querySelector('#replay-start')?.addEventListener('click', () => actions.onReplay(0, false));
  app.querySelector('#replay-play')?.addEventListener('click', () => actions.onTogglePlay());
  app.querySelector('#next')?.addEventListener('click', () => actions.onNext());

  if (state.phase === 'review' && state.playing && state.replayIndex < state.log.length - 1) {
    timers.push(setTimeout(() => actions.onReplay(state.replayIndex + 1, true), CONFIG.ui.playbackStepMs));
  }

  if ((state.phase === 'buy' || state.phase === 'move') && state.deadline) {
    const tick = () => {
      const left = state.deadline ? state.deadline - Date.now() : 0;
      if (left <= 0) {
        actions.onTimeout();
        return;
      }
      const text = clockText(state);
      const hot = Math.ceil(left / 1000) <= 10;
      document.querySelectorAll('[data-clock]').forEach((node) => {
        node.textContent = text;
        node.classList.toggle('hot', hot);
      });
      timers.push(setTimeout(tick, 250));
    };
    timers.push(setTimeout(tick, 250));
  }
}
