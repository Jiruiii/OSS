/**
 * Render the matrix result list into the committed markdown report.
 * Zero-dependency, no wall-clock timestamp (determinism).
 */

import { canonicalize, sha256Canonical } from '../../pipeline/lib/canonical.mjs';

export const LIMITATIONS = `本報告不宣稱在任何固定時間覆蓋全城。所有數字僅適用於下方參數描述的
模擬內湖五區情境、指定節點數與接觸模型，並附各區塊標註的樣本數。接觸機率、P2P 傳輸速率與
失敗率是工程估計值，尚未由實機 spike 校準（見 \`simulator/fixtures/sim-config.json\` 的
\`transport_params_source\`）。**Energy Cost 未建模** —— 依 system.md §7 需指定機型實機量測。
災情事件為虛構（真實 OSM 地物 + 合成事件），不代表任何真實災況。`;

const TICKS = '▁▂▃▄▅▆▇█';

function sparkline(values) {
  return values.map((v) => TICKS[Math.min(7, Math.max(0, Math.round(v * 7)))]).join('');
}

function pct(value) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function kib(bytes) {
  return `${Math.round(bytes / 1024).toLocaleString('en-US')} KiB`;
}

function rowLabel(key) {
  const parts = key.split('-');
  const geo = parts.at(-1) === 'geo';
  const nodeCount = parts[0];
  const strategy = parts.slice(1, geo ? -1 : undefined).join('-');
  return `${String(nodeCount).padStart(3)} · ${strategy}${geo ? ' · geo' : ''}`;
}

export function renderReport(results, scenario, config) {
  const seed = results[0]?.params.seed;
  const rounds = results[0]?.params.rounds;
  const secondsPerRound = results[0]?.params.seconds_per_round;
  const windowMinutes = ((rounds * secondsPerRound) / 60).toFixed(0);
  const configHash = sha256Canonical(config);
  const eventCount = scenario.eventIdentities.length;

  const lines = [];
  const push = (...text) => lines.push(...text);

  push('# ResilientGeo Mesh — 內湖擴散模擬報告', '');
  push('<!-- 由 `node simulator/cli.mjs matrix` 生成，請勿手改。`matrix --check` 會位元比對。 -->', '');

  push('## 情境參數', '');
  push('| 項目 | 值 |', '| --- | --- |');
  push(`| scenario_id | \`${config.scenario_id}\` |`);
  push(`| seed | ${seed} |`);
  push(`| sim-config.json sha256 | \`${configHash}\` |`);
  push(`| 節點數 | ${config.node_counts.join(', ')} |`);
  push(`| 回合 × 每回合秒數 | ${rounds} × ${secondsPerRound}s（模擬 ${windowMinutes} 分鐘） |`);
  push(`| 發布模型 | round 0 一次性發布 |`);
  push(`| rarity_scope | \`${results[0]?.params.rarity_scope}\` |`);
  push(`| 來源 fixture | \`data/fixtures/neihu/${scenario.fixture}\`（生成器 seed ${scenario.generatorSeed}） |`);
  push(`| 執行時 bundle | \`${scenario.manifest.manifest_id}\`，${scenario.chunkCount} chunk，${kib(scenario.totalSizeBytes)} |`);
  push(`| 事件識別數 \\|E\\| | ${eventCount} |`);
  push('');

  // 1. Data Coverage
  push('## 1. Data Coverage', '');
  push('每格 = 該回合前持有事件最新版的節點比例（對全部 |E| 平均）。`relevant` 欄只算節點想要的事件（geo-filter 有開時才不同）。', '');
  push('| 節點·策略 | T+1 | T+3 | T+5 | T+10 | final | relevant final | 曲線 |');
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | :-- |');
  for (const r of results) {
    const c = r.coverage;
    push(
      `| ${rowLabel(r.key)} | ${pct(c.curve[0])} | ${pct(c.curve[1])} | ${pct(c.curve[2])} | ${pct(c.curve[3])} | ${pct(c.final)} | ${pct(c.relevant_final)} | \`${sparkline(c.per_round)}\` |`,
    );
  }
  push('');
  push(
    `> 條件：seed ${seed}；${rounds} 回合 @ ${secondsPerRound}s；round 0 一次性發布；每格樣本 = N × |E|（10/20/50/100 → ${config.node_counts.map((n) => (n * eventCount).toLocaleString('en-US')).join(' / ')} 個 event-holding）。曲線為每回合 coverage 的 sparkline（${TICKS[0]}=0，${TICKS[7]}=100%）。`,
    '',
  );

  // 2. Freshness Lag
  push('## 2. Freshness Lag', '');
  push('事件發布到節點套用最新版的時間。未達成的 (節點, 事件) 配對以計數呈現，不當作無限延遲。', '');
  push('| 節點·策略 | p50 | p95 | applied pairs | unreached pairs |');
  push('| --- | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const f = r.freshness;
    const p50 = f.p50_seconds === null ? 'n/a' : `${f.p50_seconds}s (${f.p50_minutes}m)`;
    const p95 = f.p95_seconds === null ? 'n/a' : `${f.p95_seconds}s (${f.p95_minutes}m)`;
    push(
      `| ${rowLabel(r.key)} | ${p50} | ${p95} | ${f.applied_pairs.toLocaleString('en-US')} | ${f.unreached_pairs.toLocaleString('en-US')} |`,
    );
  }
  push('', `> 條件：seed ${seed}；p50/p95 為 nearest-rank，樣本 = applied pairs 欄。`, '');

  // 3. Cellular Savings
  push('## 3. Cellular Savings', '');
  push(
    'baseline = 節點最終持有的每個 byte 都當作向 server 下載。所以 no-coop（每片都是 server 拉的）落在 0，協作策略落在高點。`vs full` = 相對「每台各自下載整份資料集」，geo-filter 的效益在這欄顯現。',
    '',
  );
  push('| 節點·策略 | baseline | actual (cellular) | savings | vs full | bytes saved | server fetches |');
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const c = r.cellular;
    push(
      `| ${rowLabel(r.key)} | ${kib(c.baseline_bytes)} | ${kib(c.actual_bytes)} | ${pct(c.savings)} | ${pct(c.total_vs_full)} | ${kib(c.bytes_saved)} | ${c.server_fetches.toLocaleString('en-US')} |`,
    );
  }
  push(
    '',
    `> 條件：seed ${seed}；固定情境、固定 seed ⇒ 每次跑數字相同（\`matrix --check\`）。baseline / actual / vs full 皆為 N 個節點加總。`,
    '',
  );

  // 4. Transfer Efficiency
  push('## 4. Transfer Efficiency', '');
  push('有效 payload / 總 P2P 傳輸量。三個比率相加為 1。no-coop 無 P2P，全欄 n/a。', '');
  push('| 節點·策略 | efficiency | duplicate | failure | transfers | failed | useful bytes |');
  push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const t = r.transfer;
    push(
      `| ${rowLabel(r.key)} | ${pct(t.efficiency)} | ${pct(t.duplicate_ratio)} | ${pct(t.failure_ratio)} | ${t.transfers.toLocaleString('en-US')} | ${t.failed_transfers.toLocaleString('en-US')} | ${kib(t.useful_bytes)} |`,
    );
  }
  push(
    '',
    `> 條件：seed ${seed}；「有效」= chunk 通過 verify 且至少一個事件被新套用；樣本 = transfers 欄（成功傳輸次數）。`,
    '',
  );

  push('## Limitations', '', LIMITATIONS, '');

  return `${lines.join('\n')}\n`;
}

export function matrixSummary(results, scenario, config) {
  return {
    scenario_id: config.scenario_id,
    seed: results[0]?.params.seed,
    config_sha256: sha256Canonical(config),
    fixture: scenario.fixture,
    generator_seed: scenario.generatorSeed,
    manifest_id: scenario.manifest.manifest_id,
    chunk_count: scenario.chunkCount,
    total_size_bytes: scenario.totalSizeBytes,
    event_count: scenario.eventIdentities.length,
    runs: results.map((r) => ({
      key: r.key,
      coverage_final: r.coverage.final,
      coverage_relevant_final: r.coverage.relevant_final,
      coverage_curve: r.coverage.curve,
      freshness_p50_seconds: r.freshness.p50_seconds,
      freshness_p95_seconds: r.freshness.p95_seconds,
      cellular_savings: r.cellular.savings,
      cellular_total_vs_full: r.cellular.total_vs_full,
      transfer_efficiency: r.transfer.efficiency,
      transfer_duplicate_ratio: r.transfer.duplicate_ratio,
      transfer_failure_ratio: r.transfer.failure_ratio,
    })),
  };
}

/** Canonical bytes of a run result with volatile fields removed, for --check. */
export function canonicalRun(result) {
  const { git_rev, ...stable } = result;
  return canonicalize(stable);
}
