import { CONFIG } from './config.js';
import { loadoutCost, weaponStrength } from './engine.js';
import { anchorPercent, mapMarkup, tokenPercent } from './board.js';
import { bindDrag } from './dnd.js';
import { changedOn, describeStage, stageTitle } from './timeline.js';

let timers = [];

export function clearTimers() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

export function formatStrength(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, '').replace('.', ',');
}

export function formatMoney(value) {
  const sign = value < 0 ? '−' : '';
  const digits = Math.abs(Math.round(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  return `${sign}${digits}\u00A0$`;
}

export function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function rulesBlock() {
  const fullRifles = CONFIG.weapons.rifle.cost * CONFIG.rules.attackFighters;
  return `
    <details>
      <summary>Правила</summary>
      <ul>
        <li>Матч до ${CONFIG.rules.winsNeeded} побед, не больше ${CONFIG.rules.maxRounds} раундов. Вы всегда атака.</li>
        <li>Раунд берёт атака, если после мида, переброса и\u00A0ротатора её сила на сайте выше. Флеш отдаёт ничью атаке, но пустой сайт занять нельзя.</li>
        <li>На сайте сила защиты ×${formatStrength(CONFIG.rules.defenderSiteMultiplier)}. Ротатор приходит туда, где вашей силы больше, и\u00A0считается как ×${formatStrength(CONFIG.rules.rotatorMultiplier)}.</li>
        <li>Победа на миде переносит ${CONFIG.rules.midTransferFighters} бойца. Вы выбираете сайт заранее, бот уносит бойца туда, где вас больше.</li>
        <li>Победа в\u00A0раунде: ${formatMoney(CONFIG.economy.winReward)}. Поражение: ${formatMoney(CONFIG.economy.lossBase)} плюс ${formatMoney(CONFIG.economy.lossStreakStep)} за каждое прошлое поражение подряд, не больше ${CONFIG.economy.maxLossStreakSteps} шагов.</li>
        <li>Бот покупает винтовки только на всех сразу. Это ${formatMoney(fullRifles)}, за этот матч обычно не набирается.</li>
      </ul>
    </details>
  `;
}

function header(state) {
  const pips = Array.from({ length: CONFIG.rules.maxRounds }, (_, index) => {
    const winner = state.history[index];
    const current = !winner && index === state.round - 1;
    const cls = winner === 'attack' ? 'win-attack' : winner === 'defense' ? 'win-defense' : current ? 'current' : '';
    return `<span class="pip ${cls}"></span>`;
  }).join('');
  return `
    <header class="top">
      <div>
        <p class="eyebrow">тестовая сборка · атака против бота</p>
        <h1>${esc(CONFIG.map.name)}</h1>
      </div>
      <div class="wallet">
        <span class="muted">Ваши деньги</span>
        <strong>${formatMoney(state.wallets.attack)}</strong>
      </div>
    </header>
    <section class="scoreboard">
      <div class="side t">
        <span class="role">T · атака</span>
        <span class="num">${state.score.attack}</span>
      </div>
      <div class="meta">
        <div>Раунд ${state.round} из ${CONFIG.rules.maxRounds}</div>
        <div>до ${CONFIG.rules.winsNeeded} побед</div>
        <div class="pips">${pips}</div>
      </div>
      <div class="side ct">
        <span class="role">CT · защита</span>
        <span class="num">${state.score.defense}</span>
      </div>
    </section>
  `;
}

function tokenMarkup(token, selected) {
  const classes = ['token', token.side];
  if (token.rotator) classes.push('rotator');
  if (token.alive === false) classes.push('dead');
  if (selected) classes.push('selected');
  const style = token.pos ? ` style="left:${token.pos.left}%;top:${token.pos.top}%"` : '';
  const remove = token.removable
    ? `<button type="button" class="token-x" data-stop data-remove="${esc(token.id)}" aria-label="Убрать">×</button>`
    : '';
  return `
    <div class="${classes.join(' ')}" data-token="${esc(token.id)}"${style}>
      <span class="token-name">${esc(token.name)}</span>
      <span class="token-gun">${esc(token.gun)}</span>
      ${remove}
    </div>
  `;
}

function placeTokens(items) {
  const counts = {};
  const placed = [];
  const loose = [];
  for (const item of items) {
    if (!item.point) {
      loose.push(item);
      continue;
    }
    const index = counts[item.point] || 0;
    counts[item.point] = index + 1;
    placed.push({ ...item, pos: tokenPercent(item.point, index) });
  }
  return { placed, loose };
}

function planItems(state) {
  const fighters = state.draft.fighters.map((fighter, index) => ({
    id: `fighter-${index}`,
    side: 'attack',
    name: fighter.name,
    gun: CONFIG.weapons[fighter.weapon].name,
    point: fighter.point,
    rotator: false,
    alive: true,
    removable: false,
  }));
  const utility = state.draft.utility.map((item, index) => ({
    id: `util-${index}`,
    side: 'attack',
    name: CONFIG.utility[item.type].name,
    gun: item.point ? 'брошен' : 'в руке',
    point: item.point,
    rotator: false,
    alive: true,
    removable: true,
  }));
  return placeTokens(fighters.concat(utility));
}

function replayItems(stage) {
  const fighters = stage.fighters
    .filter((fighter) => fighter.point)
    .map((fighter) => ({
      id: `${fighter.side}-${fighter.name}`,
      side: fighter.side,
      name: fighter.name,
      gun: CONFIG.weapons[fighter.weapon].name,
      point: fighter.point,
      rotator: fighter.rotator,
      alive: fighter.alive,
      removable: false,
    }));
  return placeTokens(fighters);
}

function badgeMarkup(id, attackStrength, defenseStrength, hideDefense, marks) {
  const pos = anchorPercent(CONFIG.map.zones[id].labelAt);
  const defense = hideDefense
    ? '<span class="badge-ct">?</span>'
    : `<span class="badge-ct">${formatStrength(defenseStrength)}</span>`;
  const chips = [];
  if (marks.smokes.includes(id)) chips.push('<span class="chip smoke">дым</span>');
  if (marks.flashes.includes(id)) chips.push('<span class="chip flash">флеш</span>');
  return `
    <div class="badge" style="left:${pos.left}%;top:${pos.top}%">
      <span class="badge-t">${formatStrength(attackStrength)}</span>
      ${defense}
      ${chips.join('')}
    </div>
  `;
}

function planStrength(draft, pointId) {
  return draft.fighters
    .filter((fighter) => fighter.point === pointId)
    .reduce((sum, fighter) => sum + weaponStrength(fighter.weapon, pointId, CONFIG), 0);
}

function badges(state) {
  if (state.phase === 'plan') {
    const marks = {
      smokes: state.draft.utility.filter((item) => item.type === 'smoke' && item.point).map((item) => item.point),
      flashes: state.draft.utility.filter((item) => item.type === 'flash' && item.point).map((item) => item.point),
    };
    return CONFIG.pointOrder.map((id) => badgeMarkup(id, planStrength(state.draft, id), 0, true, marks)).join('');
  }
  const stage = state.result.stages[state.replayIndex];
  return CONFIG.pointOrder.map((id) => badgeMarkup(
    id,
    stage.points[id].attackStrength,
    stage.points[id].defenseFinal,
    false,
    stage,
  )).join('');
}

function midArrow(state) {
  if (state.phase !== 'plan') return '';
  const onMid = state.draft.fighters.some((fighter) => fighter.point === 'MID');
  if (!onMid) return '';
  const pos = anchorPercent(CONFIG.map.zones.MID.labelAt);
  return `
    <button type="button" class="mid-arrow" data-stop data-mid style="left:${pos.left}%;top:${pos.top}%">
      мид наш → ${esc(state.draft.midTransfer)}
    </button>
  `;
}

function weaponPicker(state) {
  if (!state.draft.selected || !state.draft.selected.startsWith('fighter-')) {
    return '<p class="hint">Нажмите бойца, чтобы сменить оружие.</p>';
  }
  const index = Number(state.draft.selected.slice('fighter-'.length));
  const fighter = state.draft.fighters[index];
  const buttons = CONFIG.weaponOrder.map((id) => {
    const weapon = CONFIG.weapons[id];
    const fighters = state.draft.fighters.map((item, itemIndex) => (
      itemIndex === index ? { ...item, weapon: id } : item
    ));
    const cost = loadoutCost(fighters, state.draft.utility, CONFIG);
    const short = cost - state.wallets.attack;
    const disabled = short > 0 ? ' disabled' : '';
    const current = fighter.weapon === id ? ' current' : '';
    const note = short > 0 ? ` · не хватает ${formatMoney(short)}` : '';
    let detail = `сила ${formatStrength(weapon.strength)}`;
    if (weapon.longStrength != null) {
      detail = `длинная ${formatStrength(weapon.longStrength)} / короткая ${formatStrength(weapon.shortStrength)}`;
    }
    return `
      <button type="button" class="weapon${current}" data-weapon="${esc(id)}"${disabled}>
        ${esc(weapon.name)} · ${formatMoney(weapon.cost)} · ${detail}${note}
      </button>
    `;
  }).join('');
  return `<p class="picker-name">${esc(fighter.name)}</p>${buttons}`;
}

function grenadeButtons(state) {
  return CONFIG.utilityOrder.map((id) => {
    const item = CONFIG.utility[id];
    const next = state.draft.utility.concat([{ type: id, point: null }]);
    const full = state.draft.utility.length >= CONFIG.rules.maxUtility;
    const short = loadoutCost(state.draft.fighters, next, CONFIG) - state.wallets.attack;
    const disabled = full || short > 0 ? ' disabled' : '';
    const why = full ? ' · лимит' : short > 0 ? ` · не хватает ${formatMoney(short)}` : '';
    return `<button type="button" data-buy="${esc(id)}"${disabled}>${esc(item.name)} · ${formatMoney(item.cost)}${why}</button>`;
  }).join('');
}

function fightControl(state) {
  const unplaced = state.draft.fighters.filter((fighter) => !fighter.point).length;
  const cost = loadoutCost(state.draft.fighters, state.draft.utility, CONFIG);
  const short = cost - state.wallets.attack;
  const ready = unplaced === 0 && short <= 0;
  let label = 'В\u00A0бой';
  if (unplaced) label = `На карте не все: ${unplaced}`;
  else if (short > 0) label = `Не хватает ${formatMoney(short)}`;
  const thrown = state.draft.utility.filter((item) => !item.point).length;
  const note = thrown
    ? '<p class="hint">Неброшенные гранаты тоже списываются.</p>'
    : '';
  return `
    <p class="cost-line ${ready ? 'ok' : 'bad'}">Набор ${formatMoney(cost)}. Останется ${formatMoney(state.wallets.attack - cost)}.</p>
    ${note}
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    <button type="button" id="fight"${ready ? '' : ' disabled'}>${label}</button>
  `;
}

function planPanel(state) {
  const botName = state.botPlan.weapon === 'rifle' ? 'винтовки' : 'пистолеты';
  const onMap = state.draft.selected && state.draft.selected.startsWith('fighter-')
    && state.draft.fighters[Number(state.draft.selected.slice('fighter-'.length))]?.point;
  const picker = onMap
    ? '<p class="hint">Оружие открыто у\u00A0бойца на карте.</p>'
    : `<div class="picker">${weaponPicker(state)}</div>`;
  return `
    <section class="panel">
      <h2>Закуп</h2>
      <p class="lede">Перетащите бойца на зону или нажмите его, потом зону.</p>
      ${picker}
      <div class="actions grenades">
        ${grenadeButtons(state)}
      </div>
      <p class="hint">Набор противника: ${botName}, ${formatMoney(state.botPlan.cost)}. Где они стоят, видно после вскрытия.</p>
      ${fightControl(state)}
      ${rulesBlock()}
    </section>
  `;
}

function stepList(state) {
  const stages = state.result.stages;
  return stages.map((stage, index) => {
    const previous = stages[index - 1] || stage;
    const described = describeStage(stage, previous, state.result);
    let cls = 'future';
    if (index < state.replayIndex) cls = 'done';
    if (index === state.replayIndex) cls = 'current';
    return `<li class="step-line ${cls}"><strong>${esc(described.title)}.</strong> ${esc(described.text)}</li>`;
  }).join('');
}

function debugTable(state) {
  const stages = state.result.stages;
  const rows = CONFIG.pointOrder.map((id) => {
    const point = state.result.points[id];
    let outcome = 'удержана';
    if (!CONFIG.points[id].isSite) {
      outcome = point.control === 'none' ? 'пусто' : point.control === 'attack' ? 'атака' : 'защита';
    } else if (point.control === 'attack') {
      outcome = 'взята';
    }
    return `
      <tr>
        <td>${esc(CONFIG.points[id].name)}</td>
        <td>${formatStrength(point.attackStrength)}</td>
        <td>${formatStrength(point.defenseBeforeUtility)}</td>
        <td>${point.smokePenalty ? `−${formatStrength(point.smokePenalty)}` : '—'}</td>
        <td>${formatStrength(point.defenseFinal)}</td>
        <td>${point.flash ? 'да' : 'нет'}</td>
        <td>${outcome}</td>
        <td>${esc(stageTitle(changedOn(stages, id)))}</td>
      </tr>
    `;
  }).join('');
  const economy = state.economy.attack;
  return `
    <details open>
      <summary>Разбор раунда</summary>
      <p class="hint">Таблица\u00A0— числа самого боя. После переброса на миде на карте остаются только те, кто не ушёл.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Точка</th>
              <th>Атака</th>
              <th>Защита до смоука</th>
              <th>Смоук</th>
              <th>Защита после</th>
              <th>Флеш</th>
              <th>Итог</th>
              <th>Когда</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="hint">Вы: ${formatMoney(economy.before)} − ${formatMoney(economy.spent)} + ${formatMoney(economy.reward)} → ${formatMoney(economy.after)}.</p>
    </details>
  `;
}

function replayPanel(state) {
  const playLabel = state.playing ? 'Пауза' : 'Дальше само';
  const nextLabel = state.matchWinner ? 'Ещё матч' : 'Следующий раунд';
  const banner = state.matchWinner && state.replayIndex === state.result.stages.length - 1
    ? `<p class="result-banner ${esc(state.matchWinner)}">${state.matchWinner === 'attack' ? 'Победа атаки' : state.matchWinner === 'defense' ? 'Победа защиты' : 'Ничья'}</p>`
    : '';
  return `
    <section class="panel">
      <h2>Как сыграл раунд</h2>
      <ol class="steps">${stepList(state)}</ol>
      <div class="actions transport">
        <button type="button" id="replay-start" class="secondary">Сначала</button>
        <button type="button" id="replay-back" class="secondary">Назад</button>
        <button type="button" id="replay-play">${playLabel}</button>
        <button type="button" id="replay-forward" class="secondary">Вперёд</button>
      </div>
      ${banner}
      <div class="actions">
        <button type="button" id="next">${nextLabel}</button>
      </div>
      ${debugTable(state)}
      ${rulesBlock()}
    </section>
  `;
}

function mapPicker(state, items) {
  if (state.phase !== 'plan' || !state.draft.selected || !state.draft.selected.startsWith('fighter-')) return '';
  const token = items.placed.find((item) => item.id === state.draft.selected);
  if (!token) return '';
  return `<div class="picker pop" data-stop style="left:${token.pos.left}%;top:${token.pos.top}%">${weaponPicker(state)}</div>`;
}

function shell(state) {
  const focus = state.phase === 'replay' ? state.result.stages[state.replayIndex].focus : null;
  const items = state.phase === 'plan' ? planItems(state) : replayItems(state.result.stages[state.replayIndex]);
  const selected = state.phase === 'plan' ? state.draft.selected : null;
  const mapTokens = items.placed.map((token) => tokenMarkup(token, token.id === selected)).join('');
  const spawnTokens = items.loose.map((token) => tokenMarkup(token, token.id === selected)).join('');
  const spawn = state.phase === 'plan'
    ? `<div class="spawn" data-zone="spawn" id="spawn">${spawnTokens || '<p class="hint">Все бойцы на карте.</p>'}</div>`
    : '';
  const panel = state.phase === 'plan' ? planPanel(state) : replayPanel(state);
  return `
    ${header(state)}
    <div id="board" class="stage">
      <div class="map-column">
        <div class="map-wrap">
          ${mapMarkup(focus)}
          <div class="token-layer">
            ${badges(state)}
            ${midArrow(state)}
            ${mapPicker(state, items)}
            ${mapTokens}
          </div>
        </div>
        ${spawn}
      </div>
      ${panel}
    </div>
    <p class="foot">Тестовая сборка. Рейтинга и\u00A0ставок нет.</p>
  `;
}

export function render(state, actions) {
  clearTimers();
  document.querySelector('#app').innerHTML = shell(state);
  const board = document.querySelector('#board');
  if (state.phase === 'plan') {
    bindDrag(board, {
      onTap: (id) => actions.onSelect(id),
      onDrop: (id, zone) => actions.onMove(id, zone),
      onZone: (zone) => actions.onZone(zone),
    }, { threshold: CONFIG.ui.dragThreshold });
    bindPlan(actions);
  } else {
    bindReplay(state, actions);
  }
}

function bindPlan(actions) {
  document.querySelectorAll('[data-weapon]').forEach((button) => {
    button.addEventListener('click', () => actions.onWeapon(button.dataset.weapon));
  });
  document.querySelectorAll('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => actions.onBuyUtility(button.dataset.buy));
  });
  document.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      actions.onRemove(button.dataset.remove);
    });
  });
  const mid = document.querySelector('[data-mid]');
  if (mid) mid.addEventListener('click', () => actions.onMid());
  const fight = document.querySelector('#fight');
  if (fight) fight.addEventListener('click', () => actions.onFight());
}

function bindReplay(state, actions) {
  document.querySelector('#replay-start').addEventListener('click', () => actions.onReplay(0, true));
  document.querySelector('#replay-back').addEventListener('click', () => actions.onReplay(state.replayIndex - 1, false));
  document.querySelector('#replay-forward').addEventListener('click', () => actions.onReplay(state.replayIndex + 1, false));
  document.querySelector('#replay-play').addEventListener('click', () => actions.onTogglePlay());
  document.querySelector('#next').addEventListener('click', () => actions.onNext());
  if (!state.playing) return;
  if (state.replayIndex >= state.result.stages.length - 1) return;
  timers.push(setTimeout(() => actions.onReplay(state.replayIndex + 1, true), CONFIG.ui.playbackStepMs));
}
