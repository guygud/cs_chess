import { CONFIG } from './config.js';
import {
  bestBuy,
  movesLimit,
  shadowMarks,
  unfoundCount,
  visibleCells,
} from './engine.js';
import { cellBox, mapMarkup } from './board.js';
import { contextPlays, grenadeTarget } from './plays.js';
import {
  endText,
  fakeCaption,
  formatStrength,
  playCaption,
  resultText,
  throwCaption,
} from './timeline.js';
import { nextTip } from './tips.js';

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

function activeTip(state) {
  return nextTip({
    phase: state.phase,
    round: state.round,
    roundState: state.roundState,
    draft: state.draft,
    menu: state.phase === 'move' ? menuOf(state) : null,
    wallet: state.wallets?.attack ?? 0,
  }, state.tips || [], CONFIG);
}

function tipLine(state) {
  const tip = activeTip(state);
  if (!tip) return '';
  return `
    <p class="tip">
      <span>${esc(tip.text)}</span>
      <button type="button" id="tip-close" aria-label="Закрыть">×</button>
    </p>
  `;
}

function timerBar(state, title = '') {
  if (!state.deadline || !state.clockSeconds) {
    return title ? `<div class="timer"><b>${esc(title)}</b></div>` : '';
  }
  const left = Math.max(0, state.deadline - Date.now());
  const frac = Math.max(0, Math.min(1, left / (state.clockSeconds * 1000)));
  const hot = left <= 5000 ? ' hot' : '';
  const name = title ? `<b>${esc(title)}</b>` : '';
  return `<div class="timer${hot}">${name}<i data-timer style="transform:scaleX(${frac})"></i><span data-clock>${clockText(state)}</span></div>`;
}

function rulesBlock() {
  const hold = formatStrength(CONFIG.rules.holdMultiplier);
  const force = CONFIG.buys.find((buy) => buy.id === 'force');
  const full = CONFIG.buys.find((buy) => buy.id === 'full');
  return `
    <details class="rules">
      <summary>Как это работает</summary>
      <ul>
        <li>Матч до\u00A0${CONFIG.rules.winsNeeded} побед и\u00A0не больше ${CONFIG.rules.maxRounds} раундов. В\u00A0раунде ${CONFIG.rules.movesPerRound} хода. Обе стороны выбирают мув одновременно и\u00A0вслепую.</li>
        <li>Закуп один на\u00A0всю команду. Фул эко\u00A0— пистолеты. ${esc(force.label)}\u00A0— ${esc(CONFIG.weapons.smg.name)}, броник и\u00A0световая, ${formatMoney(force.cost)}. ${esc(full.label)}\u00A0— ${esc(CONFIG.weapons.rifle.name)}, броник, дымовая и\u00A0световая, ${formatMoney(full.cost)}. Оружие сгорает в\u00A0конце раунда.</li>
        <li>Список мувов собирается заново каждый ход: шаг к\u00A0пленту, стоять или отойти. На\u00A0плитке короткий счёт боя с\u00A0теми, кого видно. На\u00A0закуп ${CONFIG.ui.buySeconds}\u00A0секунд, на\u00A0ход ${CONFIG.ui.moveSeconds}. Время вышло\u00A0— берётся лучший доступный закуп. Если мув не выбран, все стоят.</li>
        <li>Фейк уводит ${CONFIG.rules.fakeFighters} бойцов на\u00A0другой плент. Защита подтягивается туда, где людей больше\u00A0— значит, на\u00A0вашем пленте её будет меньше. За\u00A0фейк платите тем, что двое до\u00A0боя не\u00A0дойдут.</li>
        <li>Граната бросается по\u00A0вашей кнопке и\u00A0летит в\u00A0клетку, куда идёт основная группа\u00A0— она подсвечена на\u00A0карте. Дымовая снимает ${CONFIG.utility.smoke.penalty} силы у\u00A0каждого чужого в\u00A0клетке. Световая выигрывает равный бой и\u00A0спасает своих от\u00A0потерь. На\u00A0раунд их столько, сколько в\u00A0закупе.</li>
        <li>Шаг только в\u00A0соседнюю клетку. До\u00A0плента вам три шага, защите два. Если бежите навстречу по\u00A0одной связи\u00A0— стычка на\u00A0дороге, без множителя. Выжившие доходят.</li>
        <li>Пистолет даёт 1, ${esc(CONFIG.weapons.smg.name)} ${CONFIG.weapons.smg.strength}, ${esc(CONFIG.weapons.rifle.name)} ${CONFIG.weapons.rifle.strength}. Броник снимает одну смерть за\u00A0раунд. Множитель ×${hold} только у\u00A0того, кто стоит в\u00A0своей клетке.</li>
        <li>В\u00A0углу клетки места: с\u00A0каждой стороны двое стреляют в\u00A0полную силу, третий вполсилы. Кто не\u00A0поместился, гибнет первым.</li>
        <li>Бомба ставится, когда вы живы на\u00A0пленте и\u00A0защиты там нет. После неё раунд получает ещё один ход на\u00A0разминирование: защита снимает бомбу, если дошла до\u00A0плента и\u00A0вас там не\u00A0осталось. Не\u00A0сняла\u00A0— раунд ваш. Без бомбы побеждает, у\u00A0кого больше живых. Поровну\u00A0— защита.</li>
          <li>Чужих видно в\u00A0своей клетке и\u00A0в\u00A0соседних. Разбор после раунда показывает всё.</li>
      </ul>
    </details>
  `;
}

function pieceArt(side, weapon) {
  const file = side === 'defense'
    ? (weapon === 'rifle' ? 'ct-rifle' : 'ct-pistol')
    : (weapon === 'rifle' ? 't-rifle' : 't-smg');
  const low = weapon === 'pistol' ? ' rank-low' : '';
  return `<img class="glyph${low}" src="art/${file}.png" alt="">`;
}

function stepOf(state) {
  if (state.phase === 'review') return state.log[state.replayIndex] || null;
  if (state.phase === 'reveal') return state.log.at(-1) || null;
  return null;
}

function stageOf(state) {
  if (state.phase !== 'reveal' && state.phase !== 'review') return 2;
  return state.revealStage ?? 0;
}

function roundOf(state) {
  return stepOf(state)?.state || state.roundState;
}

function attackVision(state) {
  const fighters = roundOf(state)?.fighters;
  if (!fighters) return new Set();
  return visibleCells(fighters, 'attack', CONFIG);
}

function originPoint(state, fighter) {
  if (state.phase !== 'reveal' && state.phase !== 'review') return fighter.point;
  const prev = state.phase === 'review'
    ? state.log[state.replayIndex - 1]?.state
    : state.log[state.log.length - 2]?.state;
  if (!prev) return CONFIG.spawns[fighter.side];
  return prev.fighters.find((item) => item.name === fighter.name)?.point || fighter.point;
}

function cellCenter(cellId) {
  const box = cellBox(cellId);
  return { left: box.left + box.width / 2, top: box.top + box.height / 2 };
}

function fanPoint(cellId, index, total) {
  const box = cellBox(cellId);
  const cols = Math.min(3, Math.max(total, 1));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    left: box.left + box.width * (0.5 + (col - (cols - 1) / 2) * 0.3),
    top: box.top + box.height * (0.5 + row * 0.24),
  };
}

function pct(point) {
  return { left: `${point.left}%`, top: `${point.top}%` };
}

function strengthOf(fighter, owned, stayed, showHold) {
  const base = CONFIG.weapons[fighter.weapon]?.strength || 1;
  const stood = showHold && stayed && owned === fighter.side && fighter.alive;
  return stood ? base * CONFIG.rules.holdMultiplier : base;
}

function pieceMarkup(fighter, point, extras = {}) {
  const classes = [
    'piece',
    extras.quiet ? 'quiet' : '',
    fighter.side,
    fighter.armor && !fighter.armorUsed ? 'armored' : '',
    fighter.alive === false ? 'dead' : '',
    extras.memory ? 'memory' : '',
  ].filter(Boolean).join(' ');
  const end = pct(point.end);
  const start = pct(point.start);
  const move = start.left !== end.left || start.top !== end.top;
  const data = move
    ? ` data-from="${esc(extras.from || '')}" data-at="${esc(fighter.point)}" data-end-left="${end.left}" data-end-top="${end.top}"`
    : '';
  const style = `left:${move ? start.left : end.left};top:${move ? start.top : end.top}`;
  return `
    <span class="${classes}" style="${style}"${data} title="${esc(fighter.name)}">
      ${pieceArt(fighter.side, fighter.weapon)}
      ${extras.quiet ? '' : `<small>${esc(fighter.name)}</small>`}
      <b>${formatStrength(extras.strength)}</b>
    </span>
  `;
}

function pieceLayer(state) {
  if (state.phase === 'buy') {
    const at = fanBuckets(CONFIG.rosters.attack.map((name, index) => ({
      name,
      side: 'attack',
      weapon: 'pistol',
      armor: false,
      alive: true,
      point: CONFIG.spawns.attack,
      index,
    })));
    return `<div class="piece-layer">${at}</div>`;
  }
  const round = roundOf(state);
  if (!round) return '';
  const truth = state.phase === 'review';
  const vision = attackVision(state);
  const step = stepOf(state);
  const stage = stageOf(state);
  const showHold = stage >= 1 && (state.phase === 'reveal' || state.phase === 'review');
  const visible = [];
  for (const fighter of round.fighters) {
    const from = originPoint(state, fighter);
    const contact = step?.fights[fighter.point]?.contact
      && step.fights[fighter.point].present.some((person) => person.name === fighter.name);
    const seen = truth || fighter.side === 'attack' || vision.has(fighter.point) || contact;
    if (!seen) continue;
    const card = step?.fights[fighter.point]?.present?.find((person) => person.name === fighter.name);
    const stayed = Boolean(card ? card.stood : from === fighter.point);
    const watched = truth || fighter.side === 'attack' || (vision.has(from) && vision.has(fighter.point));
    visible.push({
      ...fighter,
      alive: stage < 2 ? true : fighter.alive,
      from,
      stayed,
      watched,
      owned: round.owned[fighter.point],
    });
  }
  const buckets = new Map();
  for (const fighter of visible) {
    if (!buckets.has(fighter.point)) buckets.set(fighter.point, []);
    buckets.get(fighter.point).push(fighter);
  }
  const pieces = [];
  for (const [cellId, group] of buckets) {
    group.forEach((fighter, index) => {
      const end = fanPoint(cellId, index, group.length);
      const travel = stage < 1 && fighter.watched && fighter.from !== cellId;
      const start = travel ? cellCenter(fighter.from) : end;
      pieces.push(pieceMarkup(fighter, { start, end }, {
        from: fighter.from,
        quiet: group.length > 2,
        strength: strengthOf(fighter, fighter.owned, fighter.stayed, showHold),
      }));
    });
  }
  if (!truth && state.roundState) {
    const marks = shadowMarks(state.roundState.fighters, state.memory || {}, 'attack', round.move, CONFIG);
    const shadows = new Map();
    for (const mark of marks) {
      if (!shadows.has(mark.point)) shadows.set(mark.point, []);
      shadows.get(mark.point).push(mark);
    }
    for (const [cellId, group] of shadows) {
      group.forEach((mark, index) => {
        const spot = fanPoint(cellId, index, group.length);
        const known = state.roundState.fighters.find((fighter) => fighter.name === mark.name);
        pieces.push(pieceMarkup({
          name: mark.name,
          side: 'defense',
          weapon: known?.weapon || 'pistol',
          armor: false,
          alive: true,
          point: cellId,
        }, { start: spot, end: spot }, { memory: true, strength: CONFIG.weapons[known?.weapon || 'pistol'].strength }));
      });
    }
  }
  return `<div class="piece-layer">${pieces.join('')}</div>`;
}

function fanBuckets(fighters) {
  return fighters.map((fighter, index) => {
    const spot = fanPoint(fighter.point, index, fighters.length);
    return pieceMarkup(fighter, { start: spot, end: spot }, {
      strength: CONFIG.weapons[fighter.weapon]?.strength || 1,
      quiet: fighters.length > 2,
    });
  }).join('');
}

function formatDiff(value) {
  if (Math.abs(value) < 0.05) return '0';
  const text = formatStrength(Math.abs(value));
  return value > 0 ? `+${text}` : `−${text}`;
}

function slotRow(count, side) {
  const full = CONFIG.rules.stackFull;
  const shooters = CONFIG.rules.stackShooters;
  const pips = [];
  for (let index = 0; index < shooters; index += 1) {
    const half = index >= full ? ' half' : '';
    const on = count > index ? ' on' : '';
    pips.push(`<i class="pip${half}${on}"></i>`);
  }
  const extra = Math.max(0, count - shooters);
  const over = extra ? `<b>+${extra}</b>` : '';
  return `<span class="${side || 'empty'}">${pips.join('')}${over}</span>`;
}

function slotsMarkup(state, cellId, fog) {
  const title = 'С\u00A0каждой стороны два полных места и\u00A0одно половинное. Кто не\u00A0поместился, гибнет первым.';
  const round = roundOf(state);
  let attack = 0;
  let defense = 0;
  if (!fog && round && state.phase !== 'buy') {
    const step = stepOf(state);
    const fight = stageOf(state) >= 1 ? step?.fights[cellId] : null;
    if (stageOf(state) < 1) {
      const truth = state.phase === 'review';
      const vision = attackVision(state);
      for (const fighter of round.fighters) {
        if (originPoint(state, fighter) !== cellId) continue;
        if (fighter.side === 'defense' && !truth && !vision.has(cellId)) continue;
        if (fighter.side === 'attack') attack += 1;
        else defense += 1;
      }
    } else if (fight) {
      attack = fight.attackCount || 0;
      defense = fight.defenseCount || 0;
    } else {
      const vision = attackVision(state);
      const truth = state.phase === 'review';
      for (const fighter of round.fighters) {
        if (!fighter.alive || fighter.point !== cellId) continue;
        if (fighter.side === 'defense' && !truth && !vision.has(cellId)) continue;
        if (fighter.side === 'attack') attack += 1;
        else defense += 1;
      }
    }
  }
  const rows = [];
  if (attack) rows.push(slotRow(attack, 'attack'));
  if (defense) rows.push(slotRow(defense, 'defense'));
  if (!rows.length) rows.push(slotRow(0, ''));
  return `<p class="slots" title="${esc(title)}">${rows.join('')}</p>`;
}

function cellsMarkup(state) {
  const round = roundOf(state);
  const step = stepOf(state);
  const truth = state.phase === 'review';
  const vision = state.phase === 'move' || state.phase === 'reveal' ? attackVision(state) : null;
  return CONFIG.cellOrder.map((cellId) => {
    const box = cellBox(cellId);
    const cell = CONFIG.map.cells[cellId];
    const owned = round?.owned?.[cellId] || cell.owner;
    const shown = stageOf(state) >= 1;
    const fight = shown ? step?.fights[cellId] : null;
    const road = shown && step ? Object.values(step.fights).filter((item) => (
      item.clash && item.contact && item.endpoints?.[0] === cellId
    )) : [];
    const touched = playerInFight(fight) || road.some(playerInFight);
    const fog = vision && !vision.has(cellId) && !touched ? ' fog' : '';
    const hot = fight?.contact || road.length ? ' hot' : '';
    const smoked = fight && ((fight.smoke?.attack || 0) + (fight.smoke?.defense || 0)) ? ' smoked' : '';
    const plant = cell.plant ? ' plant' : '';
    const bomb = round?.bomb?.point === cellId && !round.defused ? ' bombed' : '';
    const side = owned ? ` side-${owned}` : '';
    const showFloat = (truth || fight?.contact) && fight?.contact;
    const float = showFloat
      ? `<p class="float-diff ${fight.attackFinal >= fight.defenseFinal ? 'up' : 'down'}">${formatDiff(fight.attackFinal - fight.defenseFinal)}</p>`
      : '';
    const roadFloat = road.map((item) => (
      `<p class="float-diff ${item.attackFinal >= item.defenseFinal ? 'up' : 'down'}">${formatDiff(item.attackFinal - item.defenseFinal)}</p>`
    )).join('');
    const bombLine = bomb ? '<p class="cell-bomb">Бомба</p>' : '';
    return `
      <div class="cell${fog}${hot}${smoked}${plant}${bomb}${side}" data-zone="${esc(cellId)}" style="left:${box.left}%;top:${box.top}%;width:${box.width}%;height:${box.height}%">
        <p class="cell-label">${esc(cell.label)}</p>
        ${slotsMarkup(state, cellId, Boolean(fog))}
        ${bombLine}
        ${float}
        ${roadFloat}
      </div>
    `;
  }).join('');
}

function buyKit(buy) {
  const parts = [CONFIG.weapons[buy.weapon].name];
  if (buy.armor) parts.push(CONFIG.armor.name.toLowerCase());
  for (const item of buy.stock) parts.push(CONFIG.utility[item].name.toLowerCase());
  return parts.join(', ');
}

function buyOverlay(state) {
  const wallet = state.wallets.attack;
  const target = activeTip(state)?.target || null;
  const pick = bestBuy(wallet, CONFIG).id;
  const cards = CONFIG.buys.map((buy) => {
    const short = buy.cost - wallet;
    const afford = short <= 0;
    const classes = [
      'buy-card',
      buy.id === pick ? 'pick' : '',
      target === `buy:${buy.id}` ? 'coach' : '',
    ].filter(Boolean).join(' ');
    const tail = afford
      ? `<span class="buy-left">Останется ${formatMoney(wallet - buy.cost)}</span>`
      : `<span class="buy-left short">Не\u00A0хватает ${formatMoney(short)}</span>`;
    return `
      <button type="button" class="${classes}" data-buy="${esc(buy.id)}"${afford ? '' : ' disabled'}>
        <span class="buy-name">${esc(buy.label)}</span>
        <span class="buy-cost">${formatMoney(buy.cost)}</span>
        <span class="buy-kit">${esc(buyKit(buy))}</span>
        ${tail}
      </button>
    `;
  }).join('');
  return `
    <div class="buy-overlay">
      ${timerBar(state)}
      ${tipLine(state)}
      <p class="hint">Один закуп на\u00A0всю команду. Оружие сгорит в\u00A0конце раунда.</p>
      <div class="buy-cards">${cards}</div>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    </div>
  `;
}

function miniPoint(cellId) {
  const cell = CONFIG.map.cells[cellId];
  const box = CONFIG.map.viewBox;
  return [
    ((cell.x + cell.w / 2) / box.width) * 100,
    ((cell.y + cell.h / 2) / box.height) * 100,
  ];
}

function menuOf(state) {
  if (!state.roundState) return { plays: [], fake: false };
  return contextPlays(state.roundState, CONFIG, {
    fake: state.draft.fake,
    grenade: state.draft.grenade,
    memory: state.memory,
  });
}

function playEntry(state, playId = state.draft.play) {
  if (!playId) return null;
  return menuOf(state).plays.find((item) => item.id === playId) || null;
}

function miniMarkup(orders, state) {
  if (!orders || !state.roundState) return '';
  const fake = new Set(orders.fake);
  const at = Object.fromEntries(state.roundState.fighters.map((fighter) => [fighter.name, fighter.point]));
  const lines = orders.moves.map((move) => {
    const from = at[move.name];
    if (!from || from === move.to) return '';
    const [x1, y1] = miniPoint(from);
    const [x2, y2] = miniPoint(move.to);
    const kind = fake.has(move.name) ? ' fake' : '';
    return `<line class="mini-arrow${kind}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
  }).join('');
  const dots = CONFIG.cellOrder.map((cellId) => {
    const [x, y] = miniPoint(cellId);
    const plant = CONFIG.map.cells[cellId].plant ? ' plant' : '';
    return `<circle class="mini-dot${plant}" cx="${x}" cy="${y}" r="${plant ? 3.4 : 2.1}"></circle>`;
  }).join('');
  return `<svg class="mini" viewBox="0 0 100 100" aria-hidden="true">${dots}${lines}</svg>`;
}

function plannedOrders(state, playId) {
  return playEntry(state, playId)?.orders || null;
}

function grenadeRow(state, target) {
  const stock = state.roundState?.stock?.attack || [];
  if (!stock.length) return '';
  const tiles = CONFIG.utilityOrder.map((type) => {
    const left = stock.filter((item) => item === type).length;
    if (!left) return '';
    const on = state.draft.grenade === type ? ' is-on' : '';
    const coach = target === `grenade:${type}` ? ' coach' : '';
    return `
      <button type="button" class="chip${on}${coach}" data-grenade="${esc(type)}" aria-pressed="${state.draft.grenade === type}">
        <i class="grenade-mark ${esc(type)}" aria-hidden="true"></i>
        ${esc(CONFIG.utility[type].name)}${left > 1 ? ` ×${left}` : ''}
      </button>
    `;
  }).filter(Boolean).join('');
  if (!tiles) return '';
  return `<span class="chips-name">Граната</span>${tiles}`;
}

// Что случится, если нажать «Сделать ход» — словами, к стрелкам на карте.
function planCaption(state, playId = state.draft.play) {
  const entry = playEntry(state, playId);
  if (!entry) return 'Мув не выбран: все стоят на\u00A0месте.';
  return entry.forecast?.sentence ? `${entry.forecast.sentence}.` : `${entry.label}.`;
}

function verdictMarkup(forecast) {
  const tone = forecast?.tone || 'unknown';
  const score = forecast?.score || '—';
  return `<span class="verdict ${esc(tone)}"><i></i><b>${esc(score)}</b></span>`;
}

function fakeChip(state, menu, target) {
  if (!menu.fake) return '';
  const on = state.draft.fake ? ' is-on' : '';
  const coach = target === 'fake' ? ' coach' : '';
  return `<button type="button" id="fake" class="chip${on}${coach}" aria-pressed="${state.draft.fake}">Фейк</button>`;
}

function playRemote(state) {
  const target = activeTip(state)?.target || null;
  const menu = menuOf(state);
  const tiles = menu.plays.map((play) => {
    const on = state.draft.play === play.id ? ' is-on' : '';
    const coach = target === `play:${play.id}` ? ' coach' : '';
    return `
      <button type="button" class="play-button${on}${coach}" data-play="${esc(play.id)}" aria-pressed="${state.draft.play === play.id}" aria-label="${esc(play.label)}">
        ${miniMarkup(play.orders, state)}
        <span class="play-name">${esc(play.label)}</span>
        ${verdictMarkup(play.forecast)}
      </button>
    `;
  }).join('');
  const commitCoach = target === 'commit' ? ' coach' : '';
  const fake = fakeChip(state, menu, target);
  const grenades = grenadeRow(state, target);
  const chips = fake || grenades ? `<div class="chips">${fake}${grenades}</div>` : '';
  return `
    ${tipLine(state)}
    <p class="chosen">${esc(planCaption(state))}</p>
    <div class="play-grid">
      ${tiles}
    </div>
    ${chips}
    <button type="button" id="commit" class="${commitCoach.trim()}">${state.draft.play ? 'Сделать ход' : 'Стоять'}</button>
  `;
}

function playerInFight(fight) {
  return Boolean(fight?.contact && fight.present?.some((person) => person.side === 'attack'));
}

function seenFight(state, fight) {
  if (state.phase === 'review' || playerInFight(fight)) return true;
  const vision = attackVision(state);
  if (fight.point) return vision.has(fight.point);
  return Boolean(fight.endpoints?.some((cellId) => vision.has(cellId)));
}

function feed(state) {
  if (stageOf(state) < 2) return '';
  const step = stepOf(state);
  if (!step) return '';
  const lines = [];
  const caption = playCaption(step);
  if (caption) lines.push(caption);
  const fake = fakeCaption(step, CONFIG);
  if (fake) lines.push(fake);
  const mine = throwCaption(step, 'attack', CONFIG);
  if (mine) lines.push(mine);
  for (const fight of Object.values(step.fights)) {
    if (!fight.contact || !seenFight(state, fight)) continue;
    const text = resultText(fight);
    if (text) lines.push(text);
    const smoke = (fight.smoke?.attack || 0) + (fight.smoke?.defense || 0);
    if (smoke) lines.push(`Дымовая −${formatStrength(smoke)} каждому.`);
    if (fight.flash?.attack) lines.push('Световая ослепила их: своих не\u00A0потеряли.');
    if (fight.flash?.defense) lines.push('Их световая ослепила вас.');
  }
  if (state.phase === 'review' || step.planted) {
    if (step.planted) lines.push('Бомба поставлена.');
  }
  if (step.defused) lines.push('Бомба обезврежена.');
  if (!lines.length) return '';
  return `<div class="feed">${lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>`;
}

function panel(state) {
  if (state.phase === 'move') {
    const move = state.roundState.move + 1;
    const last = move > CONFIG.rules.movesPerRound
      ? '<p class="hint">Бомба стоит. Это ход на\u00A0разминирование: защита идёт снимать.</p>'
      : '';
    return `
      <section class="panel">
        ${timerBar(state, `Ход ${move} из\u00A0${movesLimit(state.roundState, CONFIG)}`)}
        ${last}
        ${playRemote(state)}
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
      </section>
    `;
  }
  if (state.phase === 'reveal') {
    const step = state.log.at(-1);
    const over = Boolean(state.roundState.winner);
    const stage = stageOf(state);
    const hint = stage < 1
      ? 'Идут на\u00A0клетки.'
      : stage < 2
        ? 'Бой в\u00A0клетках, куда сошлись.'
        : (over ? endText(state.roundState) : 'Чужих видно у\u00A0себя и\u00A0в\u00A0соседних клетках.');
    const button = stage < 2
      ? 'Показать итог'
      : (over ? 'Как было на\u00A0самом деле' : `Ход ${step.move + 1}`);
    return `
      <section class="panel">
        <h2>Ход ${step.move}</h2>
        <p class="hint">${esc(hint)}</p>
        ${feed(state)}
        <button type="button" id="continue">${button}</button>
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
      <h2>Ход ${step ? step.move : 1}</h2>
      <p class="hint">${esc(endText(state.roundState))}</p>
      ${feed(state)}
      <div class="actions transport">
        <button type="button" id="replay-start" class="secondary">Сначала</button>
        <button type="button" id="replay-back" class="secondary">Назад</button>
        <button type="button" id="replay-play">${playLabel}</button>
        <button type="button" id="replay-forward" class="secondary">Вперёд</button>
      </div>
      ${banner}
      <button type="button" id="next">${nextLabel}</button>
    </section>
  `;
}

function ghosts(state) {
  if (state.phase !== 'move' && state.phase !== 'reveal') return '';
  const round = roundOf(state);
  if (!round) return '';
  const missing = unfoundCount(round, state.memory || {}, 'attack', round.move, CONFIG);
  if (!missing) return '';
  const marks = Array.from({ length: missing }, () => `<span class="ghost">${pieceArt('defense', 'pistol')}</span>`).join('');
  return `<div class="ghosts" aria-label="Не найдено: ${missing}">${marks}</div>`;
}

function scoreboard(state) {
  const botBuy = state.bot ? CONFIG.buys.find((buy) => buy.id === state.bot.buyId) : null;
  return `
    <header class="top">
      <h1>Dust2</h1>
      ${rulesBlock()}
      <strong class="money">${formatMoney(shownMoney(state))}</strong>
    </header>
    <section class="scoreboard">
      <div><p class="role">Вы · атака</p><p class="num">${state.score.attack}</p></div>
      <p class="round">Раунд ${state.round}</p>
      <div><p class="role">Бот · защита</p><p class="num">${state.score.defense}</p><p class="meta">${esc(botBuy ? botBuy.label : 'ещё не закупился')}</p></div>
    </section>
  `;
}

function paintAim(state, playId) {
  const layer = document.querySelector('.aim-arrows');
  document.querySelectorAll('.cell.aim').forEach((node) => node.classList.remove('aim', 'aim-win', 'aim-loss', 'aim-tie', 'aim-unknown', 'aim-clear'));
  document.querySelectorAll('.aim-badge, .aim-outcome').forEach((node) => node.remove());
  if (!layer) return;
  layer.replaceChildren();
  if (state.phase !== 'move' || !state.roundState) return;
  const orders = plannedOrders(state, playId);
  if (!orders) return;
  const at = Object.fromEntries(state.roundState.fighters.map((fighter) => [fighter.name, fighter]));
  const fake = new Set(orders.fake);
  const box = CONFIG.map.viewBox;
  for (const move of orders.moves) {
    const fighter = at[move.name];
    if (!fighter || fighter.point === move.to) continue;
    const from = cellCenter(fighter.point);
    const to = cellCenter(move.to);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String((from.left / 100) * box.width));
    line.setAttribute('y1', String((from.top / 100) * box.height));
    line.setAttribute('x2', String((to.left / 100) * box.width));
    line.setAttribute('y2', String((to.top / 100) * box.height));
    line.setAttribute('class', fake.has(move.name) ? 'aim-line fake' : 'aim-line');
    layer.append(line);
  }
  const arrivals = new Map();
  for (const move of orders.moves) {
    arrivals.set(move.to, (arrivals.get(move.to) || 0) + 1);
  }
  const grenade = state.draft.grenade && state.roundState.stock.attack.includes(state.draft.grenade)
    ? { type: state.draft.grenade, point: grenadeTarget(orders, CONFIG) }
    : null;
  for (const [cellId, count] of arrivals) {
    const cell = document.querySelector(`.cell[data-zone="${cellId}"]`);
    if (!cell) continue;
    cell.classList.add('aim');
    const badge = document.createElement('p');
    badge.className = 'aim-badge';
    const bomb = grenade && grenade.point === cellId
      ? `<i class="grenade-mark ${grenade.type}"></i>`
      : '';
    badge.innerHTML = `<b>${count}</b>${bomb}`;
    cell.append(badge);
  }
  const forecast = playEntry(state, playId)?.forecast;
  if (forecast?.cell) {
    const cell = document.querySelector(`.cell[data-zone="${forecast.cell}"]`);
    if (cell) {
      cell.classList.add('aim', `aim-${forecast.tone}`);
      const mark = document.createElement('p');
      mark.className = `aim-outcome ${forecast.tone}`;
      mark.title = forecast.sentence || '';
      cell.append(mark);
    }
  }
}

function animatePieces() {
  const pieces = [...document.querySelectorAll('.piece[data-end-left]')];
  if (!pieces.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const go = () => {
    for (const piece of pieces) {
      if (!piece.isConnected) return;
      piece.style.left = piece.dataset.endLeft;
      piece.style.top = piece.dataset.endTop;
    }
  };
  if (reduce) {
    go();
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const piece of pieces) {
        if (!piece.isConnected) return;
        piece.style.transition = `left ${CONFIG.ui.moveAnimMs}ms ease-out, top ${CONFIG.ui.moveAnimMs}ms ease-out`;
      }
      go();
    });
  });
}

export function render(state, actions) {
  clearTimers();
  const app = document.querySelector('#app');
  const buying = state.phase === 'buy';
  app.innerHTML = `
    ${scoreboard(state)}
    <div class="stage ${esc(state.phase)}">
      <div class="map-column">
        ${ghosts(state)}
        <div class="map-frame${buying ? ' dim' : ''}">
          ${mapMarkup()}
          ${cellsMarkup(state)}
          ${pieceLayer(state)}
        </div>
        ${buying ? buyOverlay(state) : ''}
      </div>
      ${buying ? '' : panel(state)}
    </div>
    <p class="foot">Тестовая сборка. Рейтинга и\u00A0ставок нет.</p>
  `;

  app.querySelectorAll('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => actions.onPickBuy(button.dataset.buy));
  });
  const showPlay = (playId) => {
    paintAim(state, playId);
    const caption = app.querySelector('.chosen');
    if (caption) caption.textContent = planCaption(state, playId);
  };
  app.querySelectorAll('[data-play]').forEach((button) => {
    button.addEventListener('click', () => actions.onPickPlay(button.dataset.play));
    button.addEventListener('mouseenter', () => showPlay(button.dataset.play));
    button.addEventListener('focus', () => showPlay(button.dataset.play));
    button.addEventListener('mouseleave', () => showPlay(state.draft.play));
    button.addEventListener('blur', () => showPlay(state.draft.play));
  });
  app.querySelectorAll('[data-grenade]').forEach((button) => {
    button.addEventListener('click', () => actions.onPickGrenade(button.dataset.grenade));
  });
  app.querySelector('#fake')?.addEventListener('click', () => actions.onToggleFake());
  app.querySelector('#commit')?.addEventListener('click', () => actions.onCommitMove());
  app.querySelector('#tip-close')?.addEventListener('click', () => actions.onCloseTip());
  app.querySelector('#continue')?.addEventListener('click', () => {
    if (stageOf(state) < 2) actions.onSkipReveal();
    else actions.onContinue();
  });
  if (stageOf(state) < 2) {
    app.querySelector('.map-frame')?.addEventListener('click', () => actions.onSkipReveal());
  }
  app.querySelector('#replay-back')?.addEventListener('click', () => actions.onReplay(state.replayIndex - 1, false));
  app.querySelector('#replay-forward')?.addEventListener('click', () => actions.onReplay(state.replayIndex + 1, false));
  app.querySelector('#replay-start')?.addEventListener('click', () => actions.onReplay(0, false));
  app.querySelector('#replay-play')?.addEventListener('click', () => actions.onTogglePlay());
  app.querySelector('#next')?.addEventListener('click', () => actions.onNext());
  paintAim(state, state.draft.play);
  animatePieces();
  const tip = activeTip(state);
  if (tip) actions.onTipShown?.(tip.id);

  if ((state.phase === 'reveal' || state.phase === 'review') && stageOf(state) < 2) {
    const wait = stageOf(state) === 0 ? CONFIG.ui.moveAnimMs : CONFIG.ui.fightRevealMs;
    timers.push(setTimeout(() => actions.onRevealTick(), wait));
  } else if (state.phase === 'review' && state.playing && state.replayIndex < state.log.length - 1) {
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
      const hot = left <= 5000;
      const frac = state.clockSeconds ? Math.max(0, Math.min(1, left / (state.clockSeconds * 1000))) : 0;
      document.querySelectorAll('[data-clock]').forEach((node) => {
        node.textContent = text;
      });
      document.querySelectorAll('[data-timer]').forEach((node) => {
        node.style.transform = `scaleX(${frac})`;
      });
      document.querySelectorAll('.timer').forEach((node) => node.classList.toggle('hot', hot));
      timers.push(setTimeout(tick, 250));
    };
    timers.push(setTimeout(tick, 250));
  }
}
