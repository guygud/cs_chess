import { CONFIG } from './config.js';
import {
  applyRoundEconomy,
  bestBuy,
  createRound,
  loadoutFromBuy,
  matchStatus,
  remember,
  resolveMove,
} from './engine.js';
import { defenseOrders, planRound } from './bot.js';
import { assertPlays, contextPlays, otherPlant, withGrenade } from './plays.js';
import { clearTimers, render } from './ui.js?v=21';
import {
  LESSONS,
  TUTORIAL_KEY,
  commitReady,
  lessonAt,
  lessonDefenseOrders,
  lessonRound,
} from './tutorial.js?v=3';

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
  assertPlays(CONFIG);
}

function freshDraft() {
  return { buyId: null, play: null, fake: false, grenade: null };
}

function tutorialPending() {
  try {
    return localStorage.getItem(TUTORIAL_KEY) !== '1';
  } catch (error) {
    return false;
  }
}

function freshState() {
  return {
    phase: 'buy',
    tutorial: tutorialPending() ? { index: 0, beat: false } : null,
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
    deadline: null,
    clockSeconds: 0,
  };
}

let state;

function armClock(seconds) {
  state.clockSeconds = seconds;
  state.deadline = Date.now() + seconds * 1000;
}

function clearClock() {
  state.deadline = null;
  state.clockSeconds = 0;
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
  if (state.tutorial) {
    state.tutorial.beat = false;
    const lesson = lessonAt(state);
    if (lesson.wallet != null) state.wallets.attack = lesson.wallet;
    if (lesson.spots) {
      state.roundState = lessonRound(lesson);
      state.draft.play = lesson.presetPlay || null;
      state.phase = 'move';
    }
    clearClock();
    render(state, actions);
    return;
  }
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

const actions = {
  onPickBuy(buyId) {
    if (state.phase !== 'buy') return;
    const lesson = lessonAt(state);
    if (lesson && !lesson.allow.buys.includes(buyId)) return;
    const buy = CONFIG.buys.find((item) => item.id === buyId);
    if (!buy || buy.cost > state.wallets.attack) return;
    try {
      const attack = loadoutFromBuy('attack', buyId, CONFIG);
      state.bot = planRound('defense', state.wallets.defense, CONFIG);
      state.ledger = {
        wallets: { ...state.wallets },
        lossStreak: { ...state.lossStreak },
        score: { ...state.score },
      };
      state.bill = { attack: attack.cost, defense: state.bot.cost };
      state.roundState = createRound(
        { fighters: attack.fighters, stock: attack.stock },
        { fighters: state.bot.fighters, stock: state.bot.stock },
        CONFIG,
      );
      state.draft.buyId = buyId;
      state.draft.play = null;
      state.phase = 'move';
      state.error = null;
      if (state.tutorial) {
        state.tutorial.beat = true;
        clearClock();
        render(state, actions);
        return;
      }
      armClock(CONFIG.ui.moveSeconds);
      render(state, actions);
    } catch (error) {
      state.error = error.message;
      render(state, actions);
    }
  },
  onPickPlay(playId) {
    if (state.phase !== 'move' || state.tutorial?.beat) return;
    const lesson = lessonAt(state);
    if (lesson && !lesson.allow.plays.includes(playId)) return;
    state.draft.play = state.draft.play === playId ? null : playId;
    state.error = null;
    render(state, actions);
  },
  onToggleFake() {
    if (state.phase !== 'move' || state.tutorial) return;
    state.draft.fake = !state.draft.fake;
    render(state, actions);
  },
  onPickGrenade(type) {
    if (state.phase !== 'move' || state.tutorial?.beat) return;
    const lesson = lessonAt(state);
    if (lesson && !lesson.allow.grenades.includes(type)) return;
    if (!state.roundState.stock.attack.includes(type)) return;
    state.draft.grenade = state.draft.grenade === type ? null : type;
    render(state, actions);
  },
  onTimeout() {
    if (state.tutorial) return;
    if (state.phase !== 'buy' && state.phase !== 'move') return;
    state.deadline = null;
    if (state.phase === 'buy') {
      actions.onPickBuy(bestBuy(state.wallets.attack, CONFIG).id);
      return;
    }
    actions.onCommitMove();
  },
  onCommitMove() {
    if (state.phase !== 'move' || !state.roundState || state.tutorial?.beat) return;
    const lesson = lessonAt(state);
    if (lesson && !commitReady(lesson, state.draft)) return;
    try {
      const chosen = state.draft.play
        ? contextPlays(state.roundState, CONFIG, {
          fake: state.draft.fake,
          grenade: state.draft.grenade,
          memory: state.memory,
        }).plays.find((item) => item.id === state.draft.play)
        : null;
      const attackOrders = chosen
        ? withGrenade(chosen.orders, 'attack', state.roundState, CONFIG, state.draft.grenade)
        : { moves: [], throws: [], label: 'Стоят', fake: [] };
      const defense = lesson
        ? lessonDefenseOrders(lesson, state.roundState)
        : defenseOrders(state.roundState, CONFIG);
      const step = resolveMove(state.roundState, { attack: attackOrders, defense }, CONFIG);
      step.plays = {
        attack: attackOrders.label,
        defense: defense.label,
        fakeZone: attackOrders.fake?.length ? otherPlant(attackOrders.play.zone, CONFIG) : null,
        defenseZone: defense.play?.zone || null,
      };
      state.memory = remember(state.memory, step, 'attack');
      state.log.push(step);
      state.roundState = step.state;
      state.draft.grenade = null;
      state.phase = 'reveal';
      state.revealStage = state.tutorial ? 2 : 0;
      state.error = null;
      clearClock();
      if (state.tutorial) {
        state.tutorial.beat = true;
        render(state, actions);
        return;
      }
      if (state.roundState.winner) settle();
      render(state, actions);
    } catch (error) {
      state.error = error.message;
      render(state, actions);
    }
  },
  onRevealTick() {
    if (state.phase !== 'reveal' && state.phase !== 'review') return;
    if ((state.revealStage ?? 0) >= 2) return;
    state.revealStage = (state.revealStage ?? 0) + 1;
    render(state, actions);
  },
  onSkipReveal() {
    if (state.phase !== 'reveal' && state.phase !== 'review') return;
    if ((state.revealStage ?? 0) >= 2) return;
    state.revealStage = 2;
    render(state, actions);
  },
  onContinue() {
    if (state.roundState.winner) {
      state.phase = 'review';
      state.replayIndex = 0;
      state.revealStage = 0;
      state.playing = true;
      clearClock();
      render(state, actions);
      return;
    }
    state.phase = 'move';
    state.revealStage = 2;
    const menu = contextPlays(state.roundState, CONFIG, { memory: state.memory });
    if (!menu.fake) state.draft.fake = false;
    if (state.draft.play && !menu.plays.some((item) => item.id === state.draft.play)) {
      state.draft.play = null;
    }
    armClock(CONFIG.ui.moveSeconds);
    render(state, actions);
  },
  onReplay(index, playing) {
    const last = state.log.length - 1;
    state.replayIndex = Math.max(0, Math.min(last, index));
    state.revealStage = 0;
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
  onLessonNext() {
    if (!state.tutorial) return;
    const next = state.tutorial.index + 1;
    if (next >= LESSONS.length) {
      actions.onSkipTutorial();
      return;
    }
    state.tutorial = { index: next, beat: false };
    beginRound();
  },
  onSkipTutorial() {
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch (error) {
      state.error = error.message;
    }
    clearTimers();
    state = freshState();
    beginRound();
  },
  onTeach() {
    try {
      localStorage.removeItem(TUTORIAL_KEY);
    } catch (error) {
      state.error = error.message;
    }
    clearTimers();
    state = freshState();
    beginRound();
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
