import { CONFIG } from './config.js';
import { applyRoundEconomy, loadoutCost, matchStatus, resolveRound } from './engine.js';
import { planDefense } from './bot.js';
import { clearTimers, render } from './ui.js';

function assertConfig() {
  if (CONFIG.rosters.attack.length !== CONFIG.rules.attackFighters) {
    throw new Error('Ростер атаки не совпадает с числом бойцов');
  }
  const defense = CONFIG.rules.defensePlaced + CONFIG.rules.defenseRotators;
  if (CONFIG.rosters.defense.length !== defense) {
    throw new Error('Ростер защиты не совпадает с числом бойцов');
  }
  for (const id of CONFIG.pointOrder) {
    if (!CONFIG.map.zones[id]) throw new Error(`У точки ${id} нет зоны на карте`);
  }
}

function freshDraft() {
  return {
    fighters: CONFIG.rosters.attack.map((name) => ({
      name,
      weapon: 'pistol',
      point: null,
    })),
    utility: [],
    midTransfer: CONFIG.ui.defaultMidTransfer,
    selected: null,
  };
}

function freshState() {
  return {
    phase: 'plan',
    round: 1,
    score: { attack: 0, defense: 0 },
    wallets: {
      attack: CONFIG.economy.startMoney,
      defense: CONFIG.economy.startMoney,
    },
    lossStreak: { attack: 0, defense: 0 },
    history: [],
    botPlan: null,
    draft: freshDraft(),
    result: null,
    economy: null,
    matchWinner: null,
    error: null,
    replayIndex: 0,
    playing: false,
  };
}

let state;

function beginRound() {
  clearTimers();
  state.botPlan = planDefense(state.wallets.defense, CONFIG);
  state.draft = freshDraft();
  state.result = null;
  state.economy = null;
  state.error = null;
  state.phase = 'plan';
  state.replayIndex = 0;
  state.playing = false;
  render(state, actions);
}

function parseToken(tokenId) {
  const [kind, indexText] = tokenId.split('-');
  return { kind, index: Number(indexText) };
}

function knownZone(zone) {
  return zone === 'spawn' || Boolean(CONFIG.points[zone]);
}

const actions = {
  onSelect(tokenId) {
    state.draft.selected = state.draft.selected === tokenId ? null : tokenId;
    state.error = null;
    render(state, actions);
  },
  onMove(tokenId, zone) {
    if (!tokenId || !knownZone(zone)) {
      render(state, actions);
      return;
    }
    const point = zone === 'spawn' ? null : zone;
    const { kind, index } = parseToken(tokenId);
    if (kind === 'fighter' && state.draft.fighters[index]) {
      state.draft.fighters[index].point = point;
    }
    if (kind === 'util' && state.draft.utility[index]) {
      state.draft.utility[index].point = point;
    }
    state.draft.selected = tokenId;
    state.error = null;
    render(state, actions);
  },
  onZone(zone) {
    if (!state.draft.selected || !knownZone(zone)) return;
    actions.onMove(state.draft.selected, zone);
  },
  onWeapon(weaponId) {
    if (!state.draft.selected || !state.draft.selected.startsWith('fighter-')) return;
    const index = Number(state.draft.selected.slice('fighter-'.length));
    const fighters = state.draft.fighters.map((fighter, itemIndex) => (
      itemIndex === index ? { ...fighter, weapon: weaponId } : fighter
    ));
    if (loadoutCost(fighters, state.draft.utility, CONFIG) > state.wallets.attack) return;
    state.draft.fighters = fighters;
    state.error = null;
    render(state, actions);
  },
  onBuyUtility(type) {
    if (state.draft.utility.length >= CONFIG.rules.maxUtility) return;
    const utility = state.draft.utility.concat([{ type, point: null }]);
    if (loadoutCost(state.draft.fighters, utility, CONFIG) > state.wallets.attack) return;
    state.draft.utility = utility;
    state.error = null;
    render(state, actions);
  },
  onRemove(tokenId) {
    const { index } = parseToken(tokenId);
    state.draft.utility = state.draft.utility.filter((_, itemIndex) => itemIndex !== index);
    if (state.draft.selected === tokenId) state.draft.selected = null;
    render(state, actions);
  },
  onMid() {
    const sites = CONFIG.pointOrder.filter((id) => CONFIG.points[id].isSite);
    const current = sites.indexOf(state.draft.midTransfer);
    state.draft.midTransfer = sites[(current + 1) % sites.length];
    render(state, actions);
  },
  onFight() {
    const unplaced = state.draft.fighters.some((fighter) => !fighter.point);
    const cost = loadoutCost(state.draft.fighters, state.draft.utility, CONFIG);
    if (unplaced || cost > state.wallets.attack) return;
    const attack = {
      fighters: state.draft.fighters.map((fighter) => ({
        name: fighter.name,
        weapon: fighter.weapon,
        point: fighter.point,
        rotator: false,
      })),
      utility: state.draft.utility
        .filter((item) => item.point)
        .map((item) => ({ type: item.type, point: item.point })),
      midTransfer: state.draft.midTransfer,
      cost,
    };
    try {
      const result = resolveRound({ attack, defense: state.botPlan }, CONFIG);
      const applied = applyRoundEconomy(
        {
          wallets: state.wallets,
          lossStreak: state.lossStreak,
          score: state.score,
        },
        result,
        { attack: cost, defense: state.botPlan.cost },
        CONFIG,
      );
      state.wallets = applied.wallets;
      state.lossStreak = applied.lossStreak;
      state.score = applied.score;
      state.economy = applied.economy;
      state.result = result;
      state.history.push(result.winner);
      state.matchWinner = matchStatus(state.score, state.round, CONFIG);
      state.error = null;
      state.phase = 'replay';
      state.replayIndex = 0;
      state.playing = true;
      render(state, actions);
    } catch (error) {
      state.error = error.message;
      render(state, actions);
    }
  },
  onReplay(index, playing) {
    const last = state.result.stages.length - 1;
    state.replayIndex = Math.max(0, Math.min(last, index));
    state.playing = Boolean(playing) && state.replayIndex < last;
    render(state, actions);
  },
  onTogglePlay() {
    const last = state.result.stages.length - 1;
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

assertConfig();
state = freshState();
beginRound();
