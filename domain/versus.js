// Rules of an online duel between two players, shared by the game and by the duel server.
export const VERSUS = {
  health: 100,
  hit: 20,
  fastHit: 25,
  maxRounds: 10,
  resultMs: 5000,
  inviteMs: 20000,
  graceMs: 1500,
};
// What a player may see of a question: everything but its answer.
export function publicExercise(exercise) {
  const visible = { ...exercise };
  delete visible.answer;
  delete visible.answerHour;
  return visible;
}
// A spell is quick when cast within the first half of the allowed time.
export function isFast(elapsedMs, limitSeconds) {
  return limitSeconds > 0 && elapsedMs <= (limitSeconds * 1000) / 2;
}
// Only a right answer hurts the other mage; a mistake simply leaves the round to the rival.
export function damageFor({ correct, fast }) {
  return correct ? (fast ? VERSUS.fastHit : VERSUS.hit) : 0;
}
// A round is a race, so at most one of the two answers is right.
export function resolveRound(healthA, healthB, answerA, answerB) {
  return [Math.max(0, healthA - damageFor(answerB)), Math.max(0, healthB - damageFor(answerA))];
}
// Returns 'a', 'b', 'draw', or null while the duel goes on.
export function verdict(healthA, healthB, round) {
  if (healthA <= 0 && healthB <= 0) return 'draw';
  if (healthB <= 0) return 'a';
  if (healthA <= 0) return 'b';
  if (round < VERSUS.maxRounds) return null;
  return healthA === healthB ? 'draw' : healthA > healthB ? 'a' : 'b';
}
