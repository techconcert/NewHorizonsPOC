import { OUTCOME, WIN_COLONIES, WIN_HOLD_DAYS, WIN_POPULATION } from '../shared/colony';
import {
  META_DAY,
  META_END_DAY,
  META_OUTCOME,
  META_SCORE,
  META_WIN_STREAK,
  type Snapshot,
} from '../shared/snapshot';

/**
 * Pure view model of the end screen (M5). The run is over once the outcome is not Running; the
 * score is the number of colonists alive off the homeworld when it ended (D-096).
 */

export interface EndView {
  over: boolean;
  won: boolean;
  title: string;
  reason: string;
  score: number;
  days: number;
  scoreText: string;
}

const NOT_OVER: EndView = {
  over: false,
  won: false,
  title: '',
  reason: '',
  score: 0,
  days: 0,
  scoreText: '',
};

export function buildEndView(snap: Snapshot): EndView {
  const outcome = snap.meta[META_OUTCOME];
  if (outcome === OUTCOME.Running) return NOT_OVER;
  const score = snap.meta[META_SCORE];
  const endDay = snap.meta[META_END_DAY];
  const days = endDay > 0 ? endDay : snap.meta[META_DAY];
  let title: string;
  let reason: string;
  if (outcome === OUTCOME.Won) {
    title = 'Humanity has a new home';
    reason = `${WIN_COLONIES} colonies held ${WIN_POPULATION} people or more each for ${WIN_HOLD_DAYS} days in a row.`;
  } else if (outcome === OUTCOME.LostHomeworld) {
    title = 'The homeworld has collapsed';
    reason = 'The homeworld ran out of time before the colonies could stand on their own.';
  } else {
    title = 'No colonists are left';
    reason = 'Nobody is alive off the homeworld and it can no longer send a party.';
  }
  return {
    over: true,
    won: outcome === OUTCOME.Won,
    title,
    reason,
    score,
    days,
    scoreText: `Score: ${score} colonists living off-world after ${days} days.`,
  };
}

/** HUD line for the win goal: how long the colonies have held the target. */
export function goalText(snap: Snapshot): string {
  const streak = snap.meta[META_WIN_STREAK];
  return streak > 0
    ? `Goal: ${WIN_COLONIES} colonies of ${WIN_POPULATION}+, held ${streak} of ${WIN_HOLD_DAYS} days`
    : `Goal: ${WIN_COLONIES} colonies of ${WIN_POPULATION}+ people for ${WIN_HOLD_DAYS} days`;
}
