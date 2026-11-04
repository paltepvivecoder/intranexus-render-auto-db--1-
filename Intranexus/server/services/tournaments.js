import { randomUUID } from 'node:crypto';

export function makeRoundRobin(teamIds) {
  if (!Array.isArray(teamIds) || teamIds.length < 2) throw new Error('Kailangan ng hindi bababa sa dalawang team.');
  const slots = [...teamIds];
  if (slots.length % 2) slots.push(null);
  const rounds = slots.length - 1;
  const half = slots.length / 2;
  const fixtures = [];
  let rotation = slots;
  let matchNumber = 1;

  for (let round = 1; round <= rounds; round += 1) {
    for (let i = 0; i < half; i += 1) {
      let home = rotation[i];
      let away = rotation[rotation.length - 1 - i];
      if (home && away && ((round + i) % 2 === 1)) [home, away] = [away, home];
      if (home || away) {
        fixtures.push({
          id: randomUUID(), roundNumber: round, stage: `Round ${round}`,
          matchNumber: matchNumber++, homeTeamId: home, awayTeamId: away,
          status: home && away ? 'upcoming' : 'bye',
          winnerTeamId: home && !away ? home : (!home && away ? away : null),
          isLocked: Boolean(home || away) && !(home && away),
        });
      }
    }
    rotation = [rotation[0], rotation.at(-1), ...rotation.slice(1, -1)];
  }
  return fixtures;
}

const nextPowerOfTwo = (n) => 2 ** Math.ceil(Math.log2(n));
const stageName = (teamsRemaining) => {
  if (teamsRemaining === 2) return 'Final';
  if (teamsRemaining === 4) return 'Semifinal';
  if (teamsRemaining === 8) return 'Quarterfinal';
  return `Round of ${teamsRemaining}`;
};

export function makeSingleElimination(teamIds) {
  if (!Array.isArray(teamIds) || teamIds.length < 2) throw new Error('Kailangan ng hindi bababa sa dalawang team.');
  const size = nextPowerOfTwo(teamIds.length);
  const slots = [...teamIds, ...Array(size - teamIds.length).fill(null)];
  const rounds = Math.log2(size);
  const fixtures = [];
  const byRound = [];

  for (let round = 1; round <= rounds; round += 1) {
    const count = size / (2 ** round);
    const roundFixtures = [];
    for (let matchNumber = 1; matchNumber <= count; matchNumber += 1) {
      const fixture = {
        id: randomUUID(), roundNumber: round,
        stage: stageName(size / (2 ** (round - 1))), matchNumber,
        homeTeamId: null, awayTeamId: null, status: 'upcoming',
        winnerTeamId: null, isLocked: false, nextMatchId: null, nextSlot: null,
      };
      roundFixtures.push(fixture);
      fixtures.push(fixture);
    }
    byRound.push(roundFixtures);
  }

  // Seed first-round participants from opposite ends so byes are distributed instead of
  // producing empty first-round matches. Remaining rounds are persisted as TBD bracket nodes.
  const firstRound = byRound[0];
  for (let i = 0; i < firstRound.length; i += 1) {
    const home = slots[i];
    const away = slots[size - 1 - i];
    firstRound[i].homeTeamId = home;
    firstRound[i].awayTeamId = away;
    if (home && !away) {
      firstRound[i].status = 'bye';
      firstRound[i].winnerTeamId = home;
      firstRound[i].isLocked = true;
    } else if (!home && away) {
      firstRound[i].status = 'bye';
      firstRound[i].winnerTeamId = away;
      firstRound[i].isLocked = true;
    }
  }

  for (let round = 0; round < byRound.length - 1; round += 1) {
    byRound[round].forEach((fixture, index) => {
      const next = byRound[round + 1][Math.floor(index / 2)];
      fixture.nextMatchId = next.id;
      fixture.nextSlot = index % 2 === 0 ? 'home' : 'away';
    });
  }

  // Advance automatic byes through subsequent rounds. A destination with two
  // advancing teams becomes a scheduled match; one team against an empty slot
  // is itself an automatic bye and continues advancing.
  for (let round = 0; round < byRound.length - 1; round += 1) {
    for (const fixture of byRound[round]) {
      if (fixture.status !== 'bye' || !fixture.winnerTeamId) continue;
      const next = byRound[round + 1][Math.floor((fixture.matchNumber - 1) / 2)];
      const slot = fixture.matchNumber % 2 === 1 ? 'homeTeamId' : 'awayTeamId';
      next[slot] = fixture.winnerTeamId;
    }
    for (const next of byRound[round + 1]) {
      if (Boolean(next.homeTeamId) === Boolean(next.awayTeamId)) continue;
      next.status = 'bye';
      next.winnerTeamId = next.homeTeamId || next.awayTeamId;
      next.isLocked = true;
    }
  }

  return fixtures;
}

export function fixtureInsertValues(eventId, createdBy, fixtures) {
  return fixtures.map((fixture) => ({
    id: fixture.id,
    eventId,
    roundNumber: fixture.roundNumber,
    stage: fixture.stage,
    matchNumber: fixture.matchNumber,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    status: fixture.status,
    winnerTeamId: fixture.winnerTeamId,
    isLocked: fixture.isLocked,
    nextMatchId: fixture.nextMatchId || null,
    nextSlot: fixture.nextSlot || null,
    createdBy,
  }));
}
