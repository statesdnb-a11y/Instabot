/**
 * Starter voice for the on-screen line and the default caption.
 * Paste example captions into SEEDED_LINES when you want a specific voice.
 * The rest of the app only calls nextLine().
 */

export const SEEDED_LINES = [
  "We kept calling it timing, which is what people say when the room finally agrees.",
  "Some loves are not lightning, just the decision to leave the porch light on.",
  "I like us best in the hour that has no plans and no audience.",
  "We did not complete each other, we stopped performing the missing piece.",
  "Intimacy is just two people letting the sentence stay unfinished.",
  "You reached for the salt, and I understood the whole theory of home.",
  "The ordinary Tuesday is the only vow that ever held.",
  "I brought you my unedited hour, and you did not ask me to tidy it.",
  "Love, in our case, is a small room with the window cracked and nobody leaving.",
  "We mistook recognition for fate, and then we were kind enough to stay.",
  "Nothing about us is cinematic, which is why I trust it.",
  "You looked over mid-laugh, and the rest of the evening sat down.",
  "If this is ordinary, I would like an ordinary life with you in it.",
  "I do not need a grand reason when your shoulder in the doorway is plenty.",
  "We learned each other's pauses and called that fluency.",
  "Somewhere between the second glass and the walk home, we became a fact.",
  "Hold the ordinary still long enough and it starts to look like devotion.",
  "Two coffees and one opinion about the rain, and the day decided to be ours.",
  "We are not a story yet, only the weather two people keep choosing.",
  "I keep choosing the version of the day where you are already in the room.",
];

export function nextLine(exclude: string[] = []) {
  const blocked = new Set(exclude);
  const fresh = SEEDED_LINES.filter((line) => !blocked.has(line));
  const pool = fresh.length > 0 ? fresh : SEEDED_LINES;
  return pool[Math.floor(Math.random() * pool.length)] ?? SEEDED_LINES[0];
}
