export const ADVENTURE_MODES = ['clock', 'math'];
export const LEVEL_XP = 100;
export const LEVELS_PER_STAR = 20;
export const XP_PER_STAR = LEVEL_XP * LEVELS_PER_STAR;
export const MAX_STARS = 3;
export const MAX_HEALTH = 100;
export const ENEMY_DAMAGE = 25;
export function freshAdventure() {
  return {
    xp: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    cycleCorrect: 0,
    levelStartCorrect: 0,
    health: MAX_HEALTH,
    defeats: 0,
    rewards: [],
  };
}
export function journeyFor(xp = 0) {
  const total = Math.max(0, Number.isFinite(xp) ? Math.floor(xp) : 0);
  const stars = Math.min(MAX_STARS, Math.floor(total / XP_PER_STAR));
  const complete = stars === MAX_STARS;
  const cycleXP = complete ? XP_PER_STAR : total % XP_PER_STAR;
  return {
    stars,
    targetStar: Math.min(MAX_STARS, stars + 1),
    complete,
    cycleXP,
    stageIndex: complete ? 19 : Math.floor(cycleXP / LEVEL_XP),
    level: complete ? 20 : 1 + Math.floor(cycleXP / LEVEL_XP),
    remaining: LEVEL_XP - (total % LEVEL_XP),
  };
}
// Each level keeps its own stars: one per difficulty beaten (1, 2 then 3 stars).
// `cursor` says which level is being played and at which difficulty, in the XP scale
// read by journeyFor: (star - 1) × 2000 + level × 100 + XP already won on that level.
// `xp` stays the total ever earned. Saves from before per-level stars have neither
// `cursor` nor `stars`: both are then read from the XP, which followed that same scale.
const LAST = LEVELS_PER_STAR - 1;
export function cursorOf(adventure) {
  return adventure.cursor ?? adventure.xp ?? 0;
}
export function starsFromXP(xp) {
  const journey = journeyFor(xp);
  return Array.from({ length: LEVELS_PER_STAR }, (_, index) =>
    journey.complete ? MAX_STARS : journey.stars + Number(index < journey.stageIndex),
  );
}
export function starsOf(adventure) {
  return adventure.stars ?? starsFromXP(cursorOf(adventure));
}
/** Stars of the whole adventure: the difficulty beaten on every level. */
export function adventureStars(adventure) {
  return Math.min(...starsOf(adventure));
}
/** Index of the first level never beaten, or of the last level once all are. */
export function frontierOf(stars) {
  const index = stars.indexOf(0);
  return index === -1 ? LAST : index;
}
export function levelUnlocked(stars, index) {
  return index === 0 || stars[index] > 0 || stars[index - 1] > 0;
}
/** Where the cursor stands to play `index` at the first difficulty not beaten yet. */
export function runCursor(stars, index, partial = 0) {
  return (
    (Math.min(MAX_STARS, stars[index] + 1) - 1) * XP_PER_STAR +
    index * LEVEL_XP +
    Math.min(LEVEL_XP - 1, partial)
  );
}
/** Stars and cursor once the level under `cursor` is beaten, `carry` XP spilling over. */
export function afterLevelWon(stars, cursor, carry = 0, partial = []) {
  const run = journeyFor(cursor);
  const next = [...stars];
  if (run.complete) return { stars: next, cursor, index: LAST };
  next[run.stageIndex] = Math.max(next[run.stageIndex], run.targetStar);
  if (next.every((count) => count === MAX_STARS))
    return { stars: next, cursor: MAX_STARS * XP_PER_STAR + carry, index: LAST };
  const index = run.stageIndex < LAST ? run.stageIndex + 1 : next.indexOf(Math.min(...next));
  return { stars: next, cursor: runCursor(next, index, (partial[index] ?? 0) + carry), index };
}
/** Puts the mage on a level chosen on the map, at its next difficulty. */
export function selectLevel(state, mode, index) {
  if (!ADVENTURE_MODES.includes(mode)) throw new Error('Aventure inconnue');
  const previous = adventureFor(state, mode);
  const stars = starsOf(previous);
  if (!Number.isInteger(index) || index < 0 || index > LAST || !levelUnlocked(stars, index))
    throw new Error('Niveau verrouillé');
  const run = journeyFor(cursorOf(previous));
  if (!run.complete && run.stageIndex === index) return state;
  const next = structuredClone(state);
  const progress = next.adventures[mode];
  progress.stars = stars;
  progress.partial = [...(previous.partial ?? Array(LEVELS_PER_STAR).fill(0))];
  if (!run.complete) progress.partial[run.stageIndex] = cursorOf(previous) % LEVEL_XP;
  progress.cursor = runCursor(stars, index, progress.partial[index]);
  progress.partial[index] = 0;
  return next;
}
export function adventureFor(state, mode) {
  return (
    state.adventures?.[mode] ?? {
      ...freshAdventure(),
      xp: state.xp ?? 0,
      cursor: state.xp ?? 0,
      stars: starsFromXP(state.xp ?? 0),
      score: state.score ?? 0,
      streak: state.streak ?? 0,
      bestStreak: state.bestStreak ?? 0,
      rewards: state.rewards ?? [],
    }
  );
}
export function difficultyForAdventure(mode, settings, adventure) {
  const journey = journeyFor(cursorOf(adventure)),
    star = journey.targetStar,
    mastery = adventure.cycleCorrect;
  let level;
  if (mode === 'clock') {
    const floor = [0, 3, 4][star - 1];
    const auto =
      star === 1
        ? Math.min(3, Math.floor(mastery / 20))
        : star === 2
          ? Math.min(4, 3 + Math.floor(mastery / 20))
          : 4;
    level = settings.clockLevel === 'auto' ? auto : Math.max(floor, Number(settings.clockLevel));
  } else {
    const floor = star - 1;
    const auto =
      star === 1
        ? Math.min(1, Math.floor(mastery / 40))
        : star === 2
          ? Math.min(2, 1 + Math.floor(mastery / 40))
          : 2;
    const selected = { easy: 0, medium: 1, advanced: 2 }[settings.difficulty];
    level = selected === undefined ? auto : Math.max(floor, selected);
  }
  return {
    level,
    star,
    stageIndex: journey.stageIndex,
    timeFactor: [1, 0.8, 0.65][star - 1] * (1 - journey.stageIndex * 0.01),
  };
}
export function resetAdventure(state, mode) {
  if (!ADVENTURE_MODES.includes(mode)) throw new Error('Aventure inconnue');
  const next = structuredClone(state);
  next.unlocksXP = Math.max(state.unlocksXP ?? state.xp, state.xp);
  next.adventures[mode] = freshAdventure();
  next.xp = next.adventures.clock.xp + next.adventures.math.xp;
  next.score = next.adventures.clock.score + next.adventures.math.score;
  next.streak = 0;
  next.bestStreak = Math.max(next.adventures.clock.bestStreak, next.adventures.math.bestStreak);
  next.rewards = [
    ...new Set([
      ...(next.legacyRewards ?? []),
      ...next.adventures.clock.rewards,
      ...next.adventures.math.rewards,
    ]),
  ];
  return next;
}

// A defeat costs nothing already earned: the mage gets a full life back and tries again.
export function restartLevel(state, mode) {
  if (!ADVENTURE_MODES.includes(mode)) throw new Error('Aventure inconnue');
  const previous = adventureFor(state, mode);
  if (previous.health !== 0) throw new Error('Le duel n’est pas perdu');
  const next = structuredClone(state);
  const progress = next.adventures[mode];
  progress.health = MAX_HEALTH;
  progress.streak = 0;
  next.streak = 0;
  return next;
}
