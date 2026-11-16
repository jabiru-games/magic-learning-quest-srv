import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSUS,
  publicExercise,
  isFast,
  damageFor,
  resolveRound,
  verdict,
} from '../domain/versus.js';
import { generateMath, generateClock } from '../domain/exercises.js';
import { Lobby } from '../lobby.js';

// A lobby driven by hand: fake clock, timers fired on demand, fixed questions.
function arena() {
  let time = 0;
  const timers = new Set();
  const lobby = new Lobby({
    now: () => time,
    setTimer: (fn, ms) => {
      const timer = { fn, at: time + ms };
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => timers.delete(timer),
    random: () => 0,
  });
  const join = (name, levels) => {
    const inbox = [];
    const id = lobby.connect((message) => inbox.push(message));
    lobby.receive(id, { t: 'hello', name, avatar: { kind: 'girl' }, levels });
    return { id, inbox, last: (t) => inbox.findLast((m) => m.t === t) };
  };
  // Fires due timers in order, each at its own time, including those they schedule.
  const advance = (ms) => {
    const target = time + ms;
    for (;;) {
      const due = [...timers].filter((t) => t.at <= target).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      timers.delete(due);
      time = due.at;
      due.fn();
    }
    time = target;
  };
  return { lobby, join, advance };
}
const duel = (levels) => {
  const a = arena();
  const lina = a.join('Lina', levels),
    leo = a.join('Léo', levels);
  a.lobby.receive(lina.id, { t: 'challenge', to: leo.id, mode: 'math' });
  a.lobby.receive(leo.id, { t: 'reply', accept: true });
  return { ...a, lina, leo };
};
// With random fixed at 0 every maths question is 1 + 1.
const RIGHT = '2',
  WRONG = '7';

test('règles : dégâts, sort éclair, égalité et limite de manches', () => {
  assert.equal(damageFor({ correct: true, fast: false }), VERSUS.hit);
  assert.equal(damageFor({ correct: true, fast: true }), VERSUS.fastHit);
  assert.equal(damageFor({ correct: false, fast: true }), 0);
  assert.equal(isFast(15000, 30), true);
  assert.equal(isFast(15001, 30), false);
  assert.equal(isFast(0, 0), false);
  assert.deepEqual(
    resolveRound(100, 100, { correct: true, fast: true }, { correct: false }),
    [100, 75],
  );
  assert.deepEqual(resolveRound(10, 20, { correct: true }, { correct: true }), [0, 0]);
  assert.equal(verdict(100, 80, 1), null);
  assert.equal(verdict(0, 0, 3), 'draw');
  assert.equal(verdict(20, 0, 3), 'a');
  assert.equal(verdict(0, 20, 3), 'b');
  assert.equal(verdict(60, 60, VERSUS.maxRounds), 'draw');
  assert.equal(verdict(60, 80, VERSUS.maxRounds), 'b');
});
test('une question envoyée à un joueur ne contient jamais sa réponse', () => {
  const math = publicExercise(generateMath(1, () => 0.5));
  assert.equal('answer' in math, false);
  assert.equal(math.mode, 'math');
  const clock = publicExercise(generateClock(2, () => 0.9, true));
  assert.equal('answerHour' in clock, false);
  assert.equal(clock.period, 'afternoon');
});
test('salon : chacun voit les autres, noms nettoyés, avatar normalisé', () => {
  const { lobby, join } = arena();
  const lina = join('  <b>Lina</b>\u0007 la très très grande magicienne  ');
  assert.equal(lina.last('welcome').id, lina.id);
  assert.deepEqual(lina.last('players').list, []);
  const leo = join('Léo');
  const seen = leo.last('players').list;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name.length <= 18, true);
  assert.equal(seen[0].name.includes('\u0007'), false);
  assert.equal(seen[0].avatar.kind, 'girl');
  assert.equal(seen[0].avatar.robe, 'violet');
  assert.equal(lina.last('players').list[0].name, 'Léo');
  lobby.disconnect(leo.id);
  assert.deepEqual(lina.last('players').list, []);
});
test('défi : invitation, refus, annulation, délai et joueur occupé', () => {
  const { lobby, join, advance } = arena();
  const lina = join('Lina'),
    leo = join('Léo'),
    maya = join('Maya');
  lobby.receive(lina.id, { t: 'challenge', to: lina.id, mode: 'math' });
  assert.equal(lina.last('error').code, 'gone');
  lobby.receive(lina.id, { t: 'challenge', to: leo.id, mode: 'chess' });
  assert.equal(lina.last('error').code, 'mode');
  lobby.receive(lina.id, { t: 'challenge', to: leo.id, mode: 'clock' });
  assert.equal(leo.last('invite').from.name, 'Lina');
  assert.equal(leo.last('invite').mode, 'clock');
  assert.equal(lina.last('pending').to.name, 'Léo');
  lobby.receive(maya.id, { t: 'challenge', to: leo.id, mode: 'math' });
  assert.equal(maya.last('error').code, 'busy');
  lobby.receive(leo.id, { t: 'reply', accept: false });
  assert.equal(lina.last('invite-closed').reason, 'declined');
  lobby.receive(lina.id, { t: 'challenge', to: leo.id, mode: 'clock' });
  lobby.receive(lina.id, { t: 'cancel' });
  assert.equal(leo.last('invite-closed').reason, 'cancelled');
  lobby.receive(lina.id, { t: 'challenge', to: leo.id, mode: 'clock' });
  advance(VERSUS.inviteMs);
  assert.equal(lina.last('invite-closed').reason, 'timeout');
  assert.equal(leo.last('invite-closed').reason, 'timeout');
  lobby.receive(lina.id, { t: 'challenge', to: leo.id, mode: 'clock' });
  lobby.disconnect(lina.id);
  assert.equal(leo.last('invite-closed').reason, 'gone');
  lobby.receive(maya.id, { t: 'challenge', to: leo.id, mode: 'math' });
  assert.equal(leo.last('invite').from.name, 'Maya');
});
test('duel : questions sans réponse, validation côté serveur et course au premier sort', () => {
  const { lobby, lina, leo, advance } = duel();
  assert.equal(lina.last('duel-start').rival.name, 'Léo');
  assert.equal(lina.last('players').list[0].busy, true);
  const question = lina.last('round');
  assert.equal(question.n, 1);
  assert.equal('answer' in question.exercise, false);
  assert.equal(question.exercise.limit, 30);
  // A miss locks the player out; the other mage can still win the round.
  lobby.receive(lina.id, { t: 'answer', n: 1, value: WRONG });
  assert.equal(leo.last('rival-missed').t, 'rival-missed');
  assert.equal(lina.last('round-result'), undefined);
  lobby.receive(lina.id, { t: 'answer', n: 1, value: RIGHT });
  assert.equal(lina.last('round-result'), undefined);
  advance(20000);
  lobby.receive(leo.id, { t: 'answer', n: 1, value: RIGHT });
  const mine = lina.last('round-result'),
    theirs = leo.last('round-result');
  assert.deepEqual(
    [theirs.you.correct, theirs.you.fast, theirs.you.dealt, theirs.you.health],
    [true, false, 20, 100],
  );
  assert.deepEqual([mine.you.correct, mine.you.given, mine.you.health], [false, true, 80]);
  assert.equal(mine.you.expected, '2');
  assert.equal(mine.rival.dealt, 20);
  advance(VERSUS.resultMs);
  assert.equal(lina.last('round').n, 2);
  // The first right answer ends the round at once and beats the slower mage.
  lobby.receive(leo.id, { t: 'answer', n: 1, value: RIGHT });
  lobby.receive(lina.id, { t: 'answer', n: 2, value: RIGHT });
  const fast = lina.last('round-result'),
    slow = leo.last('round-result');
  assert.deepEqual([fast.n, fast.you.fast, fast.you.dealt, fast.rival.health], [2, true, 25, 75]);
  assert.deepEqual([slow.you.beaten, slow.you.given, slow.you.health], [true, false, 75]);
  lobby.receive(leo.id, { t: 'answer', n: 2, value: RIGHT });
  assert.equal(leo.last('round-result').you.health, 75);
  advance(VERSUS.resultMs);
  // Two misses, or nobody answering in time, cost nothing.
  lobby.receive(lina.id, { t: 'answer', n: 3, value: WRONG });
  lobby.receive(leo.id, { t: 'answer', n: 3, value: WRONG });
  assert.deepEqual(
    [lina.last('round-result').you.health, lina.last('round-result').rival.health],
    [80, 75],
  );
  advance(VERSUS.resultMs);
  advance(30000 + VERSUS.graceMs);
  const idle = leo.last('round-result');
  assert.deepEqual([idle.n, idle.you.given, idle.rival.given], [4, false, false]);
});
test('duel : victoire aux points de vie, puis retour au salon', () => {
  const { lobby, lina, leo, advance } = duel();
  for (let n = 1; n <= 4; n++) {
    lobby.receive(lina.id, { t: 'answer', n, value: RIGHT });
    lobby.receive(leo.id, { t: 'answer', n, value: WRONG });
    assert.equal(lina.last('duel-end'), undefined);
    advance(VERSUS.resultMs);
  }
  assert.deepEqual(lina.last('duel-end'), { t: 'duel-end', result: 'win', reason: 'health' });
  assert.deepEqual(leo.last('duel-end'), { t: 'duel-end', result: 'loss', reason: 'health' });
  assert.equal(lina.last('players').list[0].busy, false);
  assert.equal(lina.last('round').n, 4);
});
test('duel : dix manches sans vainqueur donnent une égalité, l’avantage sinon', () => {
  const tie = duel();
  for (let n = 1; n <= VERSUS.maxRounds; n++) tie.advance(30000 + VERSUS.graceMs + VERSUS.resultMs);
  assert.deepEqual(tie.lina.last('duel-end'), { t: 'duel-end', result: 'draw', reason: 'rounds' });
  const edge = duel();
  edge.lobby.receive(edge.leo.id, { t: 'answer', n: 1, value: RIGHT });
  edge.advance(VERSUS.resultMs);
  for (let n = 1; n <= VERSUS.maxRounds; n++)
    edge.advance(30000 + VERSUS.graceMs + VERSUS.resultMs);
  assert.equal(edge.leo.last('duel-end').result, 'win');
  assert.equal(edge.lina.last('duel-end').reason, 'rounds');
});
test('abandon ou déconnexion : la victoire revient à l’autre joueur', () => {
  const left = duel();
  left.lobby.receive(left.lina.id, { t: 'leave' });
  assert.deepEqual(left.leo.last('duel-end'), { t: 'duel-end', result: 'win', reason: 'forfeit' });
  assert.equal(left.lina.last('duel-end').result, 'loss');
  left.advance(60000);
  assert.equal(left.leo.last('round').n, 1);
  const cut = duel();
  cut.lobby.disconnect(cut.leo.id);
  assert.equal(cut.lina.last('duel-end').result, 'win');
  assert.deepEqual(cut.lina.last('players').list, []);
});
test('niveaux bornés et messages inconnus ignorés', () => {
  const { lobby, lina, leo } = duel({ clock: 99, math: -3 });
  assert.equal(lina.last('round').exercise.tier, 0);
  lobby.receive(lina.id, null);
  lobby.receive(lina.id, { t: 'constructor' });
  lobby.receive(lina.id, { t: 'answer', n: 1, value: { hour: 1 } });
  lobby.receive('nobody', { t: 'hello' });
  assert.equal(leo.last('rival-missed').t, 'rival-missed');
});
