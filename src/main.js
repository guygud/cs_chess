import { CONFIG } from './config.js';
import { applyRoundEconomy, canStep, createRound, loadoutCost, matchStatus, neighbors, remember, resolveMove } from './engine.js';
import { defenseOrders, planRound } from './bot.js';
import { clearTimers, render } from './ui.js';

function assertConfig() {
  if (CONFIG.rosters.attack.length !== CONFIG.rules.attackFighters) {
    throw new Error('Ростер атаки не совпадает с числом бойцов');
  }
  if (CONFIG.rosters.defense.length !== CONFIG.rules.defenseFighters) {
    throw new Error('Ростер защиты не совпадает с числом бойцов');
  }
  for (const id of CONFIG.cellOrder) {
    if (!CONFIG.map.cells[id]) throw new Error(`У клетки ${id} нет места на карте`);
  }
}

function freshDraft() {
  return {
    fighters: CONFIG.rosters.attack.map((name) => ({
      name,
      weapon: 'pistol',
      armor: false,
    })),
    stock: [],
    throws: [],
    to: {},
    selected: null,
  };
}

function freshState() {
  return {
    phase: 'buy',
    round: 1,
    score: { attack: 0, defense: 0 },
    wallets: {
      attack: CONFIG.economy.startMoney,
      defense: CONFIG.economy.startMoney,
    },
    lossStreak: { attack: 0, defense: 0 },
    history: [],
    bot: null,
    draft: freshDraft(),
    roundState: null,
    memory: {},
    log: [],
    ledger: null,
    bill: null,
    settled: false,
    matchWinner: null,
    error: null,
    replayIndex: 0,
    playing: false,
  };
}

let state;

function armClock(seconds) {
  state.deadline = Date.now() + seconds * 1000;
}

function clearClock() {
  state.deadline = null;
}

function beginRound() {
  clearTimers();
  state.bot = null;
  state.draft = freshDraft();
  state.roundState = null;
  state.memory = {};
  state.log = [];
  state.ledger = null;
  state.bill = null;
  state.settled = false;
  state.error = null;
  state.phase = 'buy';
  state.replayIndex = 0;
  state.playing = false;
  armClock(CONFIG.ui.buySeconds);
  render(state, actions);
}

function settle() {
  if (state.settled) return;
  const applied = applyRoundEconomy(state.ledger, state.roundState, state.bill, CONFIG);
  state.wallets = applied.wallets;
  state.lossStreak = applied.lossStreak;
  state.score = applied.score;
  state.history.push(state.roundState.winner);
  state.matchWinner = matchStatus(state.score, state.round, CONFIG);
  state.settled = true;
}

function cheapenDraft() {
  const wallet = state.wallets.attack;
  const cost = () => loadoutCost(state.draft.fighters, state.draft.stock, CONFIG);
  while (cost() > wallet && state.draft.stock.length) state.draft.stock.pop();
  while (cost() > wallet) {
    const armored = state.draft.fighters.find((fighter) => fighter.armor);
    if (!armored) break;
    armored.armor = false;
  }
  while (cost() > wallet) {
    const pricey = state.draft.fighters
      .filter((fighter) => fighter.weapon !== 'pistol')
      .sort((left, right) => CONFIG.weaponOrder.indexOf(right.weapon) - CONFIG.weaponOrder.indexOf(left.weapon))[0];
    if (!pricey) break;
    const index = CONFIG.weaponOrder.indexOf(pricey.weapon);
    pricey.weapon = CONFIG.weaponOrder[Math.max(0, index - 1)];
  }
}

function moveOrders() {
  const moves = [];
  for (const fighter of state.roundState.fighters) {
    if (fighter.side !== 'attack' || !fighter.alive) continue;
    moves.push({ name: fighter.name, to: state.draft.to[fighter.name] || fighter.point });
  }
  const throws = [];
  for (const item of state.draft.throws) {
    if (!item.point) continue;
    throws.push({ type: state.roundState.stock.attack[item.index], point: item.point });
  }
  return { moves, throws };
}

function throwTargets() {
  const cells = new Set();
  for (const fighter of state.roundState.fighters) {
    if (fighter.side !== 'attack' || !fighter.alive) continue;
    const at = state.draft.to[fighter.name] || fighter.point;
    cells.add(at);
    for (const next of neighbors(at, CONFIG)) cells.add(next);
  }
  return cells;
}

const actions = {
  onSelect(tokenId) {
    const opening = state.draft.selected !== tokenId;
    state.draft.selected = opening ? tokenId : null;
    if (opening) document.querySelector('#app').dataset.keepMenu = '1';
    state.error = null;
    render(state, actions);
  },
  onMove(tokenId, zone) {
    state.draft.selected = null;
    if (state.phase !== 'move' || !tokenId) {
      render(state, actions);
      return;
    }
    if (tokenId.startsWith('fighter-')) {
      const index = Number(tokenId.slice('fighter-'.length));
      const name = state.draft.fighters[index].name;
      const from = state.roundState.fighters.find((fighter) => fighter.name === name).point;
      if (zone && zone !== 'hand' && canStep(from, zone, CONFIG)) state.draft.to[name] = zone;
    }
    if (tokenId.startsWith('util-')) {
      const index = Number(tokenId.slice('util-'.length));
      const item = state.draft.throws.find((throwItem) => throwItem.index === index);
      if (!item) {
        render(state, actions);
        return;
      }
      if (!zone || zone === 'hand') item.point = null;
      else if (throwTargets().has(zone)) item.point = zone;
    }
    state.error = null;
    render(state, actions);
  },
  onZone() {},
  onDismiss(target) {
    const app = document.querySelector('#app');
    if (app.dataset.keepMenu === '1') {
      delete app.dataset.keepMenu;
      return;
    }
    if (!state.draft.selected) return;
    const node = target && target.nodeType === 1 ? target : target?.parentElement;
    if (node?.closest('[data-token], [data-weapon], [data-armor], [data-buy], [data-remove], #commit')) return;
    state.draft.selected = null;
    state.error = null;
    render(state, actions);
  },
  onWeapon(weaponId) {
    if (state.phase !== 'buy' || !state.draft.selected?.startsWith('fighter-')) return;
    const index = Number(state.draft.selected.slice('fighter-'.length));
    const fighters = state.draft.fighters.map((fighter, itemIndex) => (
      itemIndex === index ? { ...fighter, weapon: weaponId } : fighter
    ));
    if (loadoutCost(fighters, state.draft.stock, CONFIG) > state.wallets.attack) return;
    state.draft.fighters = fighters;
    state.error = null;
    render(state, actions);
  },
  onArmor() {
    if (state.phase !== 'buy' || !state.draft.selected?.startsWith('fighter-')) return;
    const index = Number(state.draft.selected.slice('fighter-'.length));
    const fighters = state.draft.fighters.map((fighter, itemIndex) => (
      itemIndex === index ? { ...fighter, armor: !fighter.armor } : fighter
    ));
    if (loadoutCost(fighters, state.draft.stock, CONFIG) > state.wallets.attack) return;
    state.draft.fighters = fighters;
    state.error = null;
    render(state, actions);
  },
  onBuyUtility(type) {
    if (state.phase !== 'buy') return;
    if (state.draft.stock.length >= CONFIG.rules.maxUtility) return;
    const stock = state.draft.stock.concat(type);
    if (loadoutCost(state.draft.fighters, stock, CONFIG) > state.wallets.attack) return;
    state.draft.stock = stock;
    state.error = null;
    render(state, actions);
  },
  onRemove(index) {
    if (state.phase !== 'buy') return;
    state.draft.stock = state.draft.stock.filter((_, itemIndex) => itemIndex !== index);
    render(state, actions);
  },
  onCommitBuy() {
    const cost = loadoutCost(state.draft.fighters, state.draft.stock, CONFIG);
    if (cost > state.wallets.attack) return;
    try {
      state.bot = planRound('defense', state.wallets.defense, CONFIG);
      state.ledger = {
        wallets: { ...state.wallets },
        lossStreak: { ...state.lossStreak },
        score: { ...state.score },
      };
      state.bill = { attack: cost, defense: state.bot.cost };
      state.roundState = createRound(
        { fighters: state.draft.fighters, stock: state.draft.stock },
        { fighters: state.bot.fighters, stock: state.bot.stock },
        CONFIG,
      );
      state.draft.to = {};
      for (const fighter of state.roundState.fighters) {
        if (fighter.side === 'attack') state.draft.to[fighter.name] = fighter.point;
      }
      state.draft.throws = state.roundState.stock.attack.map((_, index) => ({ index, point: null }));
      state.draft.selected = null;
      state.phase = 'move';
      state.error = null;
      armClock(CONFIG.ui.moveSeconds);
      render(state, actions);
    } catch (error) {
      state.error = error.message;
      render(state, actions);
    }
  },
  onTimeout() {
    if (state.phase !== 'buy' && state.phase !== 'move') return;
    state.deadline = null;
    if (state.phase === 'buy') {
      cheapenDraft();
      actions.onCommitBuy();
      return;
    }
    actions.onCommitMove();
  },
  onCommitMove() {
    try {
      const defense = defenseOrders(
        state.bot.route,
        CONFIG.rosters.defense,
        state.roundState.move,
        state.roundState,
        CONFIG,
      );
      const step = resolveMove(state.roundState, {
        attack: moveOrders(),
        defense,
      }, CONFIG);
      state.memory = remember(state.memory, step, 'attack');
      state.log.push(step);
      state.roundState = step.state;
      state.phase = 'reveal';
      state.error = null;
      clearClock();
      if (state.roundState.winner) settle();
      render(state, actions);
    } catch (error) {
      state.error = error.message;
      render(state, actions);
    }
  },
  onContinue() {
    if (state.roundState.winner) {
      state.phase = 'review';
      state.replayIndex = 0;
      state.playing = true;
      clearClock();
      render(state, actions);
      return;
    }
    state.phase = 'move';
    armClock(CONFIG.ui.moveSeconds);
    state.draft.to = {};
    for (const fighter of state.roundState.fighters) {
      if (fighter.side === 'attack' && fighter.alive) state.draft.to[fighter.name] = fighter.point;
    }
    state.draft.throws = state.roundState.stock.attack.map((_, index) => ({ index, point: null }));
    state.draft.selected = null;
    render(state, actions);
  },
  onReplay(index, playing) {
    const last = state.log.length - 1;
    state.replayIndex = Math.max(0, Math.min(last, index));
    state.playing = Boolean(playing) && state.replayIndex < last;
    render(state, actions);
  },
  onTogglePlay() {
    const last = state.log.length - 1;
    if (state.replayIndex >= last) {
      state.replayIndex = 0;
      state.playing = true;
    } else {
      state.playing = !state.playing;
    }
    render(state, actions);
  },
  onNext() {
    if (state.matchWinner) {
      actions.onRestart();
      return;
    }
    state.round += 1;
    beginRound();
  },
  onRestart() {
    clearTimers();
    state = freshState();
    beginRound();
  },
};

window.addEventListener('error', (event) => {
  const app = document.querySelector('#app');
  if (!app) return;
  const note = document.createElement('pre');
  note.className = 'crash';
  note.textContent = event.message || 'Ошибка скрипта';
  app.prepend(note);
});

document.querySelector('#app').addEventListener('click', (event) => actions.onDismiss(event.target));

assertConfig();
state = freshState();
beginRound();
