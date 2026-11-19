import { normalizeAvatar } from './domain/duel.js';
import {
  generateClock,
  generateMath,
  validateAnswer,
  expectedAnswer,
  timeLimit,
} from './domain/exercises.js';
import {
  VERSUS,
  publicExercise,
  isFast,
  damageFor,
  resolveRound,
  verdict,
} from './domain/versus.js';

const MODES = ['clock', 'math'];
// A private room is reached with a four-digit code shared between friends.
const ROOM_SIZE = 8;
const ROOM_TRIES = 8;
const level = (value, max) => Math.max(0, Math.min(max, Math.trunc(Number(value)) || 0));

// Keeps the list of connected players, their invitations and their duels.
// Time and randomness are injected so every rule can be tested without a network.
export class Lobby {
  constructor({
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    random = Math.random,
  } = {}) {
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.random = random;
    this.players = new Map();
    this.nextId = 1;
  }
  connect(send) {
    const player = {
      id: `p${this.nextId++}`,
      send,
      named: false,
      invite: null,
      duel: null,
      room: null,
      wrongCodes: 0,
    };
    this.players.set(player.id, player);
    return player.id;
  }
  disconnect(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.dropInvite(player, 'gone');
    if (player.duel) this.forfeit(player);
    this.players.delete(id);
    this.broadcastPlayers();
  }
  receive(id, message) {
    const player = this.players.get(id);
    if (!player || typeof message !== 'object' || message === null) return;
    const handler = {
      hello: this.hello,
      challenge: this.challenge,
      reply: this.reply,
      cancel: this.cancel,
      answer: this.answer,
      leave: this.leave,
      'room-create': this.roomCreate,
      'room-join': this.roomJoin,
      'room-leave': this.roomLeave,
    }[message.t];
    if (handler) handler.call(this, player, message);
  }
  card(player) {
    return { id: player.id, name: player.name, avatar: player.avatar, busy: !!player.duel };
  }
  broadcastPlayers() {
    const named = [...this.players.values()].filter((p) => p.named);
    for (const player of named)
      player.send({
        t: 'players',
        list: named.filter((p) => p !== player && p.room === player.room).map((p) => this.card(p)),
      });
  }
  // Rooms: players only see, and can only challenge, those sharing their room.
  // Without a code everyone is in the public room; a room lives while someone is in it.
  roomMembers(code) {
    return [...this.players.values()].filter((p) => p.room === code);
  }
  enterRoom(player, code) {
    this.dropInvite(player, 'gone');
    player.room = code;
    player.send({ t: 'room', code });
    this.broadcastPlayers();
  }
  roomCreate(player) {
    if (!player.named || player.duel) return;
    const taken = (code) => this.roomMembers(code).some((p) => p !== player);
    let number = Math.min(8999, Math.floor(this.random() * 9000));
    for (let tries = 0; taken(String(1000 + number)) && tries < 9000; tries++)
      number = (number + 1) % 9000;
    const code = String(1000 + number);
    this.enterRoom(player, code);
  }
  roomJoin(player, { code }) {
    if (!player.named || player.duel) return;
    if (player.wrongCodes >= ROOM_TRIES) return player.send({ t: 'error', code: 'room-tries' });
    const members = typeof code === 'string' && /^\d{4}$/.test(code) ? this.roomMembers(code) : [];
    if (!members.length) {
      player.wrongCodes++;
      return player.send({ t: 'error', code: 'room' });
    }
    if (members.includes(player)) return player.send({ t: 'room', code });
    if (members.length >= ROOM_SIZE) return player.send({ t: 'error', code: 'room-full' });
    this.enterRoom(player, code);
  }
  roomLeave(player) {
    if (!player.named || player.duel || player.room === null) return;
    this.enterRoom(player, null);
  }
  hello(player, { name, avatar, levels }) {
    player.avatar = normalizeAvatar({ ...avatar, name }, Number.MAX_SAFE_INTEGER);
    player.name = player.avatar.name;
    player.levels = { clock: level(levels?.clock, 4), math: level(levels?.math, 2) };
    player.named = true;
    player.send({ t: 'welcome', id: player.id });
    this.broadcastPlayers();
  }
  challenge(player, { to, mode }) {
    const rival = this.players.get(to);
    if (!player.named || player.duel || player.invite) return;
    if (!MODES.includes(mode)) return player.send({ t: 'error', code: 'mode' });
    if (!rival?.named || rival === player || rival.room !== player.room)
      return player.send({ t: 'error', code: 'gone' });
    if (rival.duel || rival.invite) return player.send({ t: 'error', code: 'busy' });
    const invite = { from: player, to: rival, mode };
    invite.timer = this.setTimer(() => this.dropInvite(player, 'timeout'), VERSUS.inviteMs);
    player.invite = rival.invite = invite;
    player.send({ t: 'pending', to: this.card(rival), mode });
    rival.send({ t: 'invite', from: this.card(player), mode });
  }
  // Ends a pending invitation and tells the other side why.
  dropInvite(player, reason) {
    const invite = player.invite;
    if (!invite) return;
    this.clearTimer(invite.timer);
    invite.from.invite = invite.to.invite = null;
    const other = invite.from === player ? invite.to : invite.from;
    if (reason === 'timeout') {
      invite.from.send({ t: 'invite-closed', reason });
      invite.to.send({ t: 'invite-closed', reason });
    } else other.send({ t: 'invite-closed', reason });
  }
  cancel(player) {
    if (player.invite?.from === player) this.dropInvite(player, 'cancelled');
  }
  reply(player, { accept }) {
    const invite = player.invite;
    if (!invite || invite.to !== player) return;
    if (!accept) return this.dropInvite(player, 'declined');
    this.clearTimer(invite.timer);
    invite.from.invite = invite.to.invite = null;
    this.startDuel(invite.from, invite.to, invite.mode);
  }
  startDuel(a, b, mode) {
    const duel = {
      mode,
      sides: [a, b].map((player) => ({ player, health: VERSUS.health, answer: null })),
      round: 0,
      timer: null,
    };
    a.duel = b.duel = duel;
    for (const [me, other] of [
      [a, b],
      [b, a],
    ])
      me.send({ t: 'duel-start', mode, rival: this.card(other), health: VERSUS.health });
    this.broadcastPlayers();
    this.nextRound(duel);
  }
  nextRound(duel) {
    duel.round++;
    duel.startedAt = this.now();
    let longest = 0;
    for (const side of duel.sides) {
      const tier = side.player.levels[duel.mode];
      side.exercise =
        duel.mode === 'clock'
          ? generateClock(tier, this.random, true)
          : generateMath(tier, this.random, undefined, 1);
      side.limit = timeLimit(duel.mode, tier);
      side.answer = null;
      longest = Math.max(longest, side.limit);
    }
    for (const side of duel.sides)
      side.player.send({
        t: 'round',
        n: duel.round,
        of: VERSUS.maxRounds,
        exercise: { ...publicExercise(side.exercise), limit: side.limit },
      });
    duel.timer = this.setTimer(() => this.closeRound(duel), longest * 1000 + VERSUS.graceMs);
  }
  // A round is a race: the first right answer casts the only spell of the round.
  answer(player, { n, value }) {
    const duel = player.duel;
    if (!duel || duel.resolving || n !== duel.round) return;
    const side = duel.sides.find((s) => s.player === player);
    if (side.answer) return;
    const elapsed = this.now() - duel.startedAt;
    const inTime = elapsed <= side.limit * 1000 + VERSUS.graceMs;
    const correct = inTime && validateAnswer(side.exercise, value);
    side.answer = { correct, fast: correct && isFast(elapsed, side.limit), given: true };
    const other = duel.sides.find((s) => s !== side);
    if (correct) {
      other.answer ??= { correct: false, fast: false, given: false, beaten: true };
      return this.closeRound(duel);
    }
    other.player.send({ t: 'rival-missed' });
    if (other.answer) this.closeRound(duel);
  }
  closeRound(duel) {
    if (duel.resolving) return;
    duel.resolving = true;
    this.clearTimer(duel.timer);
    const [a, b] = duel.sides;
    for (const side of duel.sides) side.answer ??= { correct: false, fast: false, given: false };
    [a.health, b.health] = resolveRound(a.health, b.health, a.answer, b.answer);
    const outcome = verdict(a.health, b.health, duel.round);
    for (const [me, other] of [
      [a, b],
      [b, a],
    ])
      me.player.send({
        t: 'round-result',
        n: duel.round,
        you: {
          ...me.answer,
          dealt: damageFor(me.answer),
          health: me.health,
          expected: expectedAnswer(me.exercise),
        },
        rival: { ...other.answer, dealt: damageFor(other.answer), health: other.health },
      });
    duel.timer = this.setTimer(() => {
      duel.resolving = false;
      if (!outcome) return this.nextRound(duel);
      this.endDuel(duel, outcome, a.health <= 0 || b.health <= 0 ? 'health' : 'rounds');
    }, VERSUS.resultMs);
  }
  endDuel(duel, outcome, reason) {
    this.clearTimer(duel.timer);
    const [a, b] = duel.sides;
    for (const [side, mine] of [
      [a, 'a'],
      [b, 'b'],
    ]) {
      if (side.player.duel !== duel) continue;
      side.player.duel = null;
      side.player.send({
        t: 'duel-end',
        result: outcome === 'draw' ? 'draw' : outcome === mine ? 'win' : 'loss',
        reason,
      });
    }
    this.broadcastPlayers();
  }
  // Leaving a duel, on purpose or by losing the connection, gives it to the other mage.
  forfeit(player) {
    const duel = player.duel;
    const mine = duel.sides[0].player === player ? 'a' : 'b';
    this.endDuel(duel, mine === 'a' ? 'b' : 'a', 'forfeit');
  }
  leave(player) {
    if (player.duel) this.forfeit(player);
  }
}
