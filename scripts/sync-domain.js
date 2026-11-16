import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Copies the game's rules into ./domain. Usage: npm run sync-domain -- ../magic-learning-quest
const FILES = ['duel.js', 'adventures.js', 'progression.js', 'exercises.js', 'versus.js'];
const game = resolve(process.argv[2] ?? '../magic-learning-quest');
const source = join(game, 'src', 'domain');
if (!existsSync(source)) {
  console.error(`Dossier introuvable : ${source}`);
  process.exit(1);
}
for (const file of FILES) {
  copyFileSync(join(source, file), join('domain', file));
  console.log(`domain/${file}`);
}
