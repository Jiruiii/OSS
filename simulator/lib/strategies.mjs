/**
 * The three diffusion strategies compared in the report.
 *
 * `replication` reuses teammate C's `pipeline/lib/peer-sync.mjs` verbatim for
 * the REQUEST ordering (CRITICAL > HIGH > NORMAL > LOW, then smallest-first).
 * `rarest-first` keeps CRITICAL at the front but otherwise orders by how few
 * nodes currently hold each chunk, so distinct chunks spread before copies pile
 * up. `no-coop` never runs the peer phase.
 */

import { buildRequest } from '../../pipeline/lib/peer-sync.mjs';

const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

function priorityRank(priority) {
  const rank = PRIORITY_RANK[priority];
  return rank === undefined ? PRIORITY_RANK.LOW + 1 : rank;
}

export const STRATEGY_NAMES = ['no-coop', 'replication', 'rarest-first'];

export const STRATEGIES = {
  'no-coop': {
    usesPeerPhase: false,
    allGateways: true,
    orderRequest: () => [],
  },

  replication: {
    usesPeerPhase: true,
    allGateways: false,
    orderRequest(wanted, { datasetId, namespace, manifestId }) {
      const request = buildRequest({
        dataset_id: datasetId,
        namespace,
        manifest_id: manifestId,
        missing_chunks: wanted,
        stale_chunks: [],
      });
      return request.chunks.map((chunk) => chunk.chunk_id);
    },
  },

  'rarest-first': {
    usesPeerPhase: true,
    allGateways: false,
    orderRequest(wanted, { rarity }) {
      return [...wanted]
        .sort((a, b) => {
          const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
          if (byPriority !== 0) return byPriority;
          const byRarity = (rarity.get(a.chunk_id) ?? 0) - (rarity.get(b.chunk_id) ?? 0);
          if (byRarity !== 0) return byRarity;
          const bySize = a.size_bytes - b.size_bytes;
          if (bySize !== 0) return bySize;
          return a.chunk_id < b.chunk_id ? -1 : 1;
        })
        .map((chunk) => chunk.chunk_id);
    },
  },
};

export function getStrategy(name) {
  const strategy = STRATEGIES[name];
  if (!strategy) throw new RangeError(`unknown strategy: ${name} (expected one of ${STRATEGY_NAMES.join(', ')})`);
  return strategy;
}
