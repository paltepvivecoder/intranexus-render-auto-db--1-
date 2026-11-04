import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRoundRobin, makeSingleElimination, fixtureInsertValues } from './tournaments.js';

test('round robin schedules every unique team pair exactly once for 2–8 teams', () => {
  for (let count = 2; count <= 8; count += 1) {
    const teams = Array.from({ length: count }, (_, index) => `team-${index + 1}`);
    const fixtures = makeRoundRobin(teams);
    const games = fixtures.filter((fixture) => fixture.status !== 'bye');
    const pairs = games.map((fixture) => [fixture.homeTeamId, fixture.awayTeamId].sort().join('|'));
    const expected = count * (count - 1) / 2;
    assert.equal(games.length, expected, `match count for ${count} teams`);
    assert.equal(new Set(pairs).size, expected, `unique pairs for ${count} teams`);
    for (const fixture of fixtures.filter((item) => item.status === 'bye')) {
      assert.ok(fixture.winnerTeamId);
      assert.equal(fixture.isLocked, true);
    }
  }
});

test('single elimination creates a complete power-of-two bracket and distributes byes', () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const teams = Array.from({ length: count }, (_, index) => `team-${index + 1}`);
    const fixtures = makeSingleElimination(teams);
    const size = 2 ** Math.ceil(Math.log2(count));
    assert.equal(fixtures.length, size - 1, `bracket node count for ${count} teams`);
    const firstRound = fixtures.filter((fixture) => fixture.roundNumber === 1);
    const seeded = firstRound.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]).filter(Boolean);
    assert.deepEqual([...seeded].sort(), [...teams].sort(), `all teams seeded once for ${count} teams`);
    if (size > 2) {
      assert.ok(firstRound.every((fixture) => fixture.nextMatchId && ['home', 'away'].includes(fixture.nextSlot)));
    } else {
      assert.ok(firstRound.every((fixture) => fixture.nextMatchId === null && fixture.nextSlot === null));
    }
    for (const fixture of firstRound.filter((item) => item.status === 'bye')) {
      assert.ok(fixture.winnerTeamId);
      assert.equal(fixture.isLocked, true);
    }
  }
});

test('single-elimination byes advance teams into later rounds without creating empty matches', () => {
  const fixtures = makeSingleElimination(Array.from({ length: 5 }, (_, index) => `team-${index + 1}`));
  const secondRound = fixtures.filter((fixture) => fixture.roundNumber === 2);
  assert.ok(secondRound.some((fixture) => fixture.homeTeamId || fixture.awayTeamId));
  assert.ok(secondRound.every((fixture) => fixture.status === 'bye' || fixture.status === 'upcoming'));
  for (const fixture of secondRound.filter((item) => item.status === 'bye')) {
    assert.ok(fixture.winnerTeamId);
    assert.equal(fixture.isLocked, true);
  }
});

test('fixture insert mapping preserves the approved tournament fields', () => {
  const [fixture] = makeSingleElimination(['alpha', 'beta']);
  const [values] = fixtureInsertValues('event-id', 'admin-id', [fixture]);
  assert.equal(values.eventId, 'event-id');
  assert.equal(values.createdBy, 'admin-id');
  assert.ok(values.nextMatchId === null);
  assert.ok(['Final', 'Semifinal', 'Quarterfinal', 'Round of 2'].includes(values.stage));
});

test('both generators reject fewer than two teams', () => {
  assert.throws(() => makeRoundRobin(['one']));
  assert.throws(() => makeSingleElimination([]));
});
