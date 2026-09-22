import { CONFIG } from './config.js';
import { compare, loadoutCost, weaponStrength } from './engine.js';

let timers = [];

export function clearTimers() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

function scoreText(score) {
  return `${score.attack}\u00A0:\u00A0${score.defense}`;
}

function weaponOption(id) {
  const weapon = CONFIG.weapons[id];
  let detail = `сила ${formatStrength(weapon.strength)}`;
  if (weapon.longStrength != null) {
    detail = `длинная ${formatStrength(weapon.longStrength)}, короткая ${formatStrength(weapon.shortStrength)}`;
  }
  return `<option value="${esc(id)}">${esc(weapon.name)} · ${formatMoney(weapon.cost)} · ${detail}</option>`;
}

function pointOptions(selected) {
  return CONFIG.pointOrder.map((id) => {
    const point = CONFIG.points[id];
    const mark = id === selected ? ' selected' : '';
    return `<option value="${esc(id)}"${mark}>${esc(pointLabel(point))}</option>`;
  }).join('');
}

function siteOptions(selected) {
  return CONFIG.pointOrder
    .filter((id) => CONFIG.points[id].isSite)
    .map((id) => {
      const mark = id === selected ? ' selected' : '';
      return `<option value="${esc(id)}"${mark}>${esc(CONFIG.points[id].name)}</option>`;
    })
    .join('');
}

function pointLabel(point) {
  const kind = point.isSite ? 'сайт' : 'не сайт';
  const lane = point.long ? 'длинная' : 'короткая';
  return `${point.name} · ${kind} · ${lane}`;
}

function rulesBlock() {
  const fullRifles = CONFIG.weapons.rifle.cost * CONFIG.rules.attackFighters;
  return `
    <details>
      <summary>Правила</summary>
      <ul>
        <li>Матч до ${CONFIG.rules.winsNeeded} побед, не больше ${CONFIG.rules.maxRounds} раундов. Вы всегда атака.</li>
        <li>Раунд берёт атака, если после мида, переброса и ротатора её сила на сайте выше. Флеш отдаёт ничью атаке, но пустой сайт занять нельзя.</li>
        <li>На сайте сила защиты ×${formatStrength(CONFIG.rules.defenderSiteMultiplier)}. Ротатор приходит туда, где вашей силы больше, и считается как ×${formatStrength(CONFIG.rules.rotatorMultiplier)}.</li>
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

function errorLine(state) {
  if (!state.error) return '';
  return `<p class="error">${esc(state.error)}</p>`;
}

function buyView(state) {
  const rows = CONFIG.rosters.attack.map((name, index) => {
    const selected = state.playerPlan?.fighters[index]?.weapon || 'pistol';
    const options = CONFIG.weaponOrder.map((id) => {
      const mark = id === selected ? ' selected' : '';
      return weaponOption(id).replace(`value="${id}"`, `value="${id}"${mark}`);
    }).join('');
    return `
      <div class="fighter">
        <div>
          <span class="who-name">${esc(name)}</span>
          <span class="tag">боец ${index + 1}</span>
        </div>
        <select id="weapon-${index}" name="weapon-${index}">${options}</select>
      </div>
    `;
  }).join('');

  const slots = Array.from({ length: CONFIG.rules.maxUtility }, (_, index) => {
    const selected = state.playerPlan?.utility[index]?.type || '';
    const options = ['<option value="">Нет</option>'].concat(
      CONFIG.utilityOrder.map((id) => {
        const item = CONFIG.utility[id];
        const mark = id === selected ? ' selected' : '';
        return `<option value="${esc(id)}"${mark}>${esc(item.name)} · ${formatMoney(item.cost)}</option>`;
      }),
    ).join('');
    return `
      <div class="util-row">
        <span>Слот ${index + 1}</span>
        <select id="util-${index}">${options}</select>
      </div>
    `;
  }).join('');

  const botName = state.botPlan.weapon === 'rifle' ? 'винтовки' : 'пистолеты';

  return `
    <section class="panel">
      <h2>Покупка</h2>
      <p class="lede">${CONFIG.rules.attackFighters} бойцов. За раунд не больше ${CONFIG.rules.maxUtility} гранат. Купленное сгорает после раунда.</p>
      <form id="buy-form">
        ${rows}
        <h3>Утилита</h3>
        ${slots}
        <p class="cost-line" id="cost-line"></p>
        <p class="hint">Набор противника: ${botName}, ${formatMoney(state.botPlan.cost)}. Шаблон откроется после раунда.</p>
        ${errorLine(state)}
        <div class="actions">
          <button type="submit" id="buy-next">Дальше</button>
        </div>
      </form>
      ${rulesBlock()}
    </section>
  `;
}

function deployView(state) {
  const defaults = CONFIG.ui.defaultAttackPoints;
  const rows = state.playerPlan.fighters.map((fighter, index) => {
    const fallback = defaults[index];
    const radios = CONFIG.pointOrder.map((id) => {
      const checked = id === fallback ? ' checked' : '';
      return `
        <label>
          <input type="radio" name="point-${index}" value="${esc(id)}"${checked}>
          ${esc(CONFIG.points[id].name)}
        </label>
      `;
    }).join('');
    return `
      <div class="fighter">
        <div>
          <span class="who-name">${esc(fighter.name)}</span>
          <span class="tag">${esc(CONFIG.weapons[fighter.weapon].name)}</span>
          <span class="tag" id="str-${index}"></span>
        </div>
        <div class="seg">${radios}</div>
      </div>
    `;
  }).join('');

  const utility = state.playerPlan.utility.map((item, index) => `
    <div class="util-row">
      <span>${esc(CONFIG.utility[item.type].name)}</span>
      <select id="util-point-${index}">${pointOptions(CONFIG.ui.defaultUtilityPoint)}</select>
    </div>
  `).join('');

  const utilityBlock = utility
    ? `<h3>Куда бросать</h3>${utility}`
    : '';

  return `
    <section class="panel">
      <h2>Расстановка</h2>
      <p class="lede">Сайты A и\u00A0B берут раунд. Мид сам по себе раунд не берёт: победитель переносит бойца.</p>
      <form id="deploy-form">
        ${rows}
        <p class="summary" id="deploy-summary"></p>
        ${utilityBlock}
        <div class="transfer-row">
          <span>Переброс с\u00A0мида</span>
          <select id="mid-transfer">${siteOptions(CONFIG.ui.defaultMidTransfer)}</select>
        </div>
        <p class="hint">Если возьмёте мид, самый сильный боец с\u00A0мида уйдёт на выбранный сайт.</p>
        ${errorLine(state)}
        <div class="actions">
          <button type="button" class="secondary" id="back">Назад к\u00A0покупке</button>
          <button type="submit" id="fight">В\u00A0бой</button>
        </div>
      </form>
    </section>
  `;
}

function counts(fighters) {
  return CONFIG.pointOrder.map((id) => {
    const count = fighters.filter((fighter) => !fighter.rotator && fighter.point === id).length;
    return `${esc(CONFIG.points[id].name)}\u00A0${count}`;
  }).join(', ');
}

function pointSentence(point) {
  const name = esc(CONFIG.points[point.point].name);
  const nums = `Атака ${formatStrength(point.attackStrength)}, защита ${formatStrength(point.defenseFinal)}`;
  const tie = compare(point.attackStrength, point.defenseFinal) === 0;
  const site = CONFIG.points[point.point].isSite;
  if (!site) {
    if (point.control === 'none') return `${name}. Бойцов нет, переброса не\u00A0будет.`;
    if (tie && point.flash && point.control === 'attack') {
      return `${name}. ${nums}. Ничья, флеш отдал мид атаке.`;
    }
    const who = point.control === 'attack' ? 'атакой' : 'защитой';
    return `${name}. ${nums}. Мид за\u00A0${who}.`;
  }
  if (point.attackCount === 0) return `${name}. ${nums}. Атаки нет, сайт удержан.`;
  if (tie && point.flash && point.control === 'attack') {
    return `${name}. ${nums}. Ничья, флеш отдал сайт атаке.`;
  }
  if (point.control === 'attack') return `${name}. ${nums}. Сайт взят.`;
  return `${name}. ${nums}. Сайт удержан.`;
}

function fragsHtml(frags) {
  if (!frags.length) return '';
  return frags.map((frag) => `
    <div class="frag">
      <span class="where">${esc(CONFIG.points[frag.point].name)}</span>
      <span class="who ${esc(frag.killerSide)}">${esc(frag.killer)}</span>
      <span class="how">${esc(CONFIG.weapons[frag.weapon].name)}</span>
      <span class="whom ${esc(frag.victimSide)}">${esc(frag.victim)}</span>
    </div>
  `).join('');
}

function transferSentence(result) {
  if (!result.transfers.length) return 'Переброса нет.';
  return result.transfers.map((move) => {
    const who = move.side === 'attack' ? 'Атака' : 'Защита';
    const weapon = CONFIG.weapons[move.weapon].name.toLowerCase();
    let line = `${who} переносит ${esc(move.name)} (${esc(weapon)}) с\u00A0${esc(CONFIG.points[move.from].name)} на\u00A0${esc(CONFIG.points[move.to].name)}.`;
    if (compare(move.strengthBefore, move.strengthAfter) !== 0) {
      line += ` Сила ${formatStrength(move.strengthBefore)} → ${formatStrength(move.strengthAfter)}.`;
    }
    return line;
  }).join(' ');
}

function revealSteps(state) {
  const result = state.result;
  const steps = [
    `Вы: ${counts(state.playerPlan.fighters)}.`,
    `Бот: ${counts(state.botPlan.fighters)}. Ротатор ${esc(result.rotator.name)}, ${esc(CONFIG.weapons[result.rotator.weapon].name.toLowerCase())}.`,
    pointSentence(result.points[result.midPoint]),
  ];
  const midFrags = fragsHtml(result.points[result.midPoint].frags);
  if (midFrags) steps.push(midFrags);
  steps.push(transferSentence(result));
  for (const id of CONFIG.pointOrder) {
    if (!CONFIG.points[id].isSite) continue;
    steps.push(pointSentence(result.points[id]));
    const frags = fragsHtml(result.points[id].frags);
    if (frags) steps.push(frags);
  }
  const sites = result.takenSites.length
    ? `Проход на\u00A0${result.takenSites.map((id) => esc(CONFIG.points[id].name)).join(' и ')}.`
    : 'Оба сайта удержаны.';
  const who = result.winner === 'attack' ? 'атакой' : 'защитой';
  steps.push(`Раунд за\u00A0${who}. ${sites} Счёт ${scoreText(state.score)}.`);
  const money = state.economy.attack;
  steps.push(`Вы потратили ${formatMoney(money.spent)} и\u00A0получили ${formatMoney(money.reward)}. Теперь ${formatMoney(money.after)}.`);
  if (state.matchWinner) steps.push(matchSentence(state));
  return steps;
}

function matchSentence(state) {
  const title = state.matchWinner === 'attack'
    ? 'Победа атаки'
    : state.matchWinner === 'defense'
      ? 'Победа защиты'
      : 'Ничья';
  return `Матч окончен. ${title}, ${scoreText(state.score)}.`;
}

function midControlLabel(control) {
  if (control === 'attack') return 'атака';
  if (control === 'defense') return 'защита';
  return 'пусто';
}

function debugBlock(state) {
  const result = state.result;
  const rows = CONFIG.pointOrder.map((id) => {
    const point = result.points[id];
    const tie = compare(point.attackStrength, point.defenseFinal) === 0;
    let outcome = 'удержана';
    if (!CONFIG.points[id].isSite) {
      outcome = point.control === 'none' ? 'пусто' : point.control === 'attack' ? 'атака' : 'защита';
    } else if (point.control === 'attack') {
      outcome = tie ? 'взята флешем' : 'взята';
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
      </tr>
    `;
  }).join('');

  const move = result.transfers[0];
  const transfer = move
    ? `${move.side === 'attack' ? 'атака' : 'защита'}: ${esc(move.name)} → ${esc(CONFIG.points[move.to].name)}`
    : 'нет';
  const rotator = result.rotator.point
    ? `${esc(result.rotator.name)} на\u00A0${esc(CONFIG.points[result.rotator.point].name)}, вклад ${formatStrength(result.rotator.strength)}`
    : `${esc(result.rotator.name)} не вышел`;
  const decision = result.takenSites.length
    ? `Атака прошла на\u00A0${result.takenSites.map((id) => esc(CONFIG.points[id].name)).join(' и ')}`
    : 'Оба сайта удержаны';

  return `
    <details open>
      <summary>Разбор раунда</summary>
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
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="debug-extra">
        <div>Шаблон защиты: ${esc(state.botPlan.templateId)}, оружие: ${esc(CONFIG.weapons[state.botPlan.weapon].name.toLowerCase())}</div>
        <div>Мид: ${esc(midControlLabel(result.points[result.midPoint].control))}</div>
        <div>Переброс: ${transfer}</div>
        <div>Ротатор: ${rotator}</div>
        <div>Решение раунда: ${decision}</div>
        <div>Кошелёк атаки: ${moneyTrace(state.economy.attack)}, серия ${state.economy.attack.lossStreak}</div>
        <div>Кошелёк защиты: ${moneyTrace(state.economy.defense)}, серия ${state.economy.defense.lossStreak}</div>
      </div>
    </details>
  `;
}

function moneyTrace(row) {
  return `${formatMoney(row.before)} − ${formatMoney(row.spent)} + ${formatMoney(row.reward)} → ${formatMoney(row.after)}`;
}

function revealView(state) {
  const steps = revealSteps(state).map((html) => `<div class="step"><div class="beat">${html}</div></div>`).join('');
  const title = state.matchWinner === 'attack'
    ? 'Победа атаки'
    : state.matchWinner === 'defense'
      ? 'Победа защиты'
      : state.matchWinner === 'draw'
        ? 'Ничья'
        : '';
  const banner = state.matchWinner
    ? `<div class="result-banner ${esc(state.matchWinner)}">${title}</div><p>Счёт ${scoreText(state.score)}</p>`
    : '';
  const nextLabel = state.matchWinner ? 'Ещё матч' : 'Следующий раунд';

  return `
    <section class="panel">
      <h2>Вскрытие</h2>
      <div class="feed" aria-live="polite">${steps}</div>
      ${debugBlock(state)}
      <div class="actions">
        <button type="button" class="secondary" id="skip">Показать сразу</button>
      </div>
      <div id="reveal-footer" hidden>
        ${banner}
        <div class="actions">
          <button type="button" id="next">${nextLabel}</button>
        </div>
      </div>
    </section>
  `;
}

function shell(state) {
  let body = '';
  if (state.phase === 'buy') body = buyView(state);
  if (state.phase === 'deploy') body = deployView(state);
  if (state.phase === 'reveal') body = revealView(state);
  return `${header(state)}${body}<p class="foot">Тестовая сборка. Рейтинга и\u00A0ставок нет.</p>`;
}

function readBuy() {
  const fighters = CONFIG.rosters.attack.map((name, index) => ({
    name,
    weapon: document.querySelector(`#weapon-${index}`).value,
  }));
  const utility = [];
  for (let index = 0; index < CONFIG.rules.maxUtility; index += 1) {
    const type = document.querySelector(`#util-${index}`).value;
    if (type) utility.push({ type });
  }
  return { fighters, utility, cost: loadoutCost(fighters, utility, CONFIG) };
}

function updateBuyCost(wallet) {
  const plan = readBuy();
  const left = wallet - plan.cost;
  const line = document.querySelector('#cost-line');
  const button = document.querySelector('#buy-next');
  const affordable = left >= 0;
  line.className = `cost-line ${affordable ? 'ok' : 'bad'}`;
  line.textContent = affordable
    ? `Набор ${formatMoney(plan.cost)}. Останется ${formatMoney(left)}.`
    : `Набор ${formatMoney(plan.cost)}. Не хватает ${formatMoney(plan.cost - wallet)}.`;
  button.disabled = !affordable;
}

function selectedPoint(index) {
  return document.querySelector(`input[name="point-${index}"]:checked`)?.value || null;
}

let currentWeapons = [];

function updateDeploy() {
  const summary = {};
  for (const id of CONFIG.pointOrder) summary[id] = { count: 0, strength: 0 };
  currentWeapons.forEach((weapon, index) => {
    const point = selectedPoint(index);
    const label = document.querySelector(`#str-${index}`);
    if (!point) {
      if (label) label.textContent = 'точка не выбрана';
      return;
    }
    const strength = weaponStrength(weapon, point, CONFIG);
    label.textContent = `сила ${formatStrength(strength)}`;
    summary[point].count += 1;
    summary[point].strength += strength;
  });
  const text = CONFIG.pointOrder.map((id) => {
    const row = summary[id];
    return `${CONFIG.points[id].name}: ${row.count}, сила ${formatStrength(row.strength)}`;
  }).join(' · ');
  const box = document.querySelector('#deploy-summary');
  if (box) box.textContent = text;
  const button = document.querySelector('#fight');
  if (button) button.disabled = currentWeapons.some((_, index) => !selectedPoint(index));
}

function bindBuy(state, actions) {
  const form = document.querySelector('#buy-form');
  const refresh = () => updateBuyCost(state.wallets.attack);
  form.addEventListener('input', refresh);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const plan = readBuy();
    if (plan.cost > state.wallets.attack) return;
    actions.onBuy(plan);
  });
  refresh();
}

function bindDeploy(state, actions) {
  currentWeapons = state.playerPlan.fighters.map((fighter) => fighter.weapon);
  const form = document.querySelector('#deploy-form');
  const refresh = () => updateDeploy();
  form.addEventListener('input', refresh);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fighters = state.playerPlan.fighters.map((fighter, index) => ({
      name: fighter.name,
      weapon: fighter.weapon,
      point: selectedPoint(index),
      rotator: false,
    }));
    if (fighters.some((fighter) => !fighter.point)) return;
    const utility = state.playerPlan.utility.map((item, index) => ({
      type: item.type,
      point: document.querySelector(`#util-point-${index}`).value,
    }));
    actions.onDeploy({
      fighters,
      utility,
      midTransfer: document.querySelector('#mid-transfer').value,
      cost: state.playerPlan.cost,
    });
  });
  document.querySelector('#back').addEventListener('click', () => actions.onBack());
  refresh();
}

function bindReveal(actions) {
  document.querySelector('#skip').addEventListener('click', () => {
    clearTimers();
    document.querySelectorAll('.step').forEach((step) => step.classList.add('show'));
    document.querySelector('#reveal-footer').hidden = false;
  });
  document.querySelector('#next').addEventListener('click', () => actions.onNext());
  const steps = [...document.querySelectorAll('.step')];
  steps.forEach((step, index) => {
    timers.push(setTimeout(() => {
      step.classList.add('show');
      if (index === steps.length - 1) document.querySelector('#reveal-footer').hidden = false;
    }, CONFIG.ui.revealStepMs * (index + 1)));
  });
}

export function render(state, actions) {
  clearTimers();
  const app = document.querySelector('#app');
  app.innerHTML = shell(state);
  if (state.phase === 'buy') bindBuy(state, actions);
  if (state.phase === 'deploy') {
    currentWeapons = state.playerPlan.fighters.map((fighter) => fighter.weapon);
    bindDeploy(state, actions);
  }
  if (state.phase === 'reveal') bindReveal(actions);
}
