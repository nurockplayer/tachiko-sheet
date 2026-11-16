// Longest-processing-time assignment; ties use the name, then shard index.
export function assignShards(steps, durations, count) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid shard count');
  const shards = Array.from({ length: count }, () => ({ seconds: 0, steps: [] }));
  const seconds = ({ name }) => durations[name] ?? 30;
  const ordered = [...steps].sort((a, b) => seconds(b) - seconds(a)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const step of ordered) {
    const shard = shards.reduce((best, candidate) => candidate.seconds < best.seconds ? candidate : best);
    shard.steps.push(step);
    shard.seconds += seconds(step);
  }
  // Execution keeps the runner's original order, independently of assignment.
  return shards.map((shard) => steps.filter((step) => shard.steps.includes(step)));
}

export function selectSteps(steps, durations, shard) {
  if (shard === undefined) return { shard: '1/1', steps };
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
  if (!match) throw new Error('TACHIKO_ACCEPTANCE_SHARD must be i/n (1-based)');
  const [, index, count] = match.map(Number);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count) {
    throw new Error('TACHIKO_ACCEPTANCE_SHARD must satisfy 1 <= i <= n');
  }
  return { shard, steps: assignShards(steps, durations, count)[index - 1] };
}

// Partial reruns retain successful jobs' artifacts from earlier attempts.
// Choose before reading summaries: a broken latest artifact must never fall back.
export function latestShardArtifacts(names) {
  const latest = new Map();
  let runId;
  for (const name of names) {
    const match = /^product-acceptance-shard-([1-4])-([1-9]\d*)-([1-9]\d*)$/.exec(name);
    if (!match) throw new Error(`Invalid shard artifact: ${name}`);
    const [, shard, run, attempt] = match;
    if (runId !== undefined && run !== runId) throw new Error('Shard artifacts span multiple runs');
    runId = run;
    if (!latest.has(shard) || BigInt(attempt) > BigInt(latest.get(shard).attempt)) {
      latest.set(shard, { name, shard: `${shard}/4`, attempt });
    }
  }
  return [...latest.values()];
}

export function verifyShardSummaries(expectedSteps, summaries, needs, count = 4) {
  for (const name of ['checks', 'acceptance', 'save-closure']) {
    if (needs?.[name]?.result !== 'success') throw new Error(`Need ${name} did not succeed`);
  }
  if (Object.values(needs).some((need) => need.result !== 'success')) {
    throw new Error('A need did not succeed');
  }
  if (summaries.length !== count) throw new Error(`Expected ${count} shard summaries`);
  const seenShards = new Set();
  const seenSteps = new Set();
  const expected = new Set(expectedSteps);
  for (const summary of summaries) {
    const validShards = Array.from({ length: count }, (_, i) => `${i + 1}/${count}`);
    if (!validShards.includes(summary.shard) || seenShards.has(summary.shard)) {
      throw new Error(`Invalid or duplicate shard: ${summary.shard}`);
    }
    seenShards.add(summary.shard);
    if (summary.status !== 'PASS') throw new Error(`Shard ${summary.shard} did not PASS`);
    if (!Array.isArray(summary.selectedSteps)) throw new Error('Missing selected steps');
    for (const name of summary.selectedSteps) {
      if (!expected.has(name)) throw new Error(`Unexpected step: ${name}`);
      if (seenSteps.has(name)) throw new Error(`Duplicate step: ${name}`);
      seenSteps.add(name);
      const results = summary.summary?.filter((entry) => entry.step === name) ?? [];
      if (results.length !== 1 || results[0].status !== 'PASS' || results[0].exitCode !== 0) {
        throw new Error(`Missing or unsuccessful step result: ${name}`);
      }
    }
  }
  for (const name of expected) {
    if (!seenSteps.has(name)) throw new Error(`Missing step: ${name}`);
  }
  return expectedSteps;
}
