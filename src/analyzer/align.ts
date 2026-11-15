/** Chromaprint raw fingerprints advance one 32-bit item every ~0.1238 s (1365 samples @ 11025 Hz). */
export const FP_ITEM_SEC = 1365 / 11025;

export interface FingerprintMatch {
  /** Video time (sec) at which the track's first sample sits. May be slightly negative. */
  offsetSec: number;
  /** 0..1 confidence derived from bit-error rate and probe agreement. */
  confidence: number;
  /** Bit error rate across the whole overlap (0.5 ≈ unrelated audio). */
  bitErrorRate: number;
  method: "chromaprint";
}

export interface CorrelationMatch {
  offsetSec: number;
  confidence: number;
  method: "cross-correlation";
}

const POPCOUNT = (() => {
  const table = new Uint8Array(65536);
  for (let i = 1; i < 65536; i++) table[i] = table[i >> 1] + (i & 1);
  return table;
})();

export function popcount32(value: number): number {
  return POPCOUNT[value & 0xffff] + POPCOUNT[(value >>> 16) & 0xffff];
}

/** Hamming distance between two raw fingerprint item arrays (compared index by index). */
export function hammingDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.max(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < len; i++) {
    distance += popcount32((i < a.length ? a[i] : 0) ^ (i < b.length ? b[i] : 0));
  }
  return distance;
}

/** Bit error rate of `probe` against `video` starting at `videoIndex`; null if it does not fit. */
function bitErrorRate(video: Uint32Array, probe: Uint32Array, videoIndex: number): number | null {
  if (videoIndex < 0 || videoIndex + probe.length > video.length) return null;
  let errors = 0;
  for (let i = 0; i < probe.length; i++) {
    errors += popcount32(video[videoIndex + i] ^ probe[i]);
  }
  return errors / (probe.length * 32);
}

interface ProbeHit {
  /** Index in the video fingerprint where the probe best matches. */
  videoIndex: number;
  ber: number;
}

function bestProbeHit(video: Uint32Array, probe: Uint32Array): ProbeHit | null {
  let best: ProbeHit | null = null;
  const last = video.length - probe.length;
  for (let v = 0; v <= last; v++) {
    let errors = 0;
    const limit = best === null ? Infinity : best.ber * probe.length * 32;
    for (let i = 0; i < probe.length; i++) {
      errors += popcount32(video[v + i] ^ probe[i]);
      if (errors >= limit) break;
    }
    const ber = errors / (probe.length * 32);
    if (best === null || ber < best.ber) best = { videoIndex: v, ber };
  }
  return best;
}

/**
 * Locate a track inside a (much longer) video using raw Chromaprint series.
 * Several probe windows are taken from across the track; each is slid over the whole
 * video. Probes that agree on the implied track start vote for it, and the winning start
 * is scored over the entire overlap.
 */
export function matchFingerprintSeries(
  videoItems: ArrayLike<number>,
  trackItems: ArrayLike<number>,
  options: { probeItems?: number; probeCount?: number; agreeToleranceItems?: number } = {},
): FingerprintMatch | null {
  const video = Uint32Array.from(videoItems);
  const track = Uint32Array.from(trackItems);
  const probeItems = Math.min(options.probeItems ?? 160, track.length);
  const probeCount = options.probeCount ?? 4;
  const tolerance = options.agreeToleranceItems ?? 3;
  if (probeItems < 16 || video.length < probeItems) return null;

  const starts: number[] = [];
  const span = track.length - probeItems;
  for (let k = 0; k < probeCount; k++) {
    starts.push(probeCount === 1 ? 0 : Math.round((span * k) / (probeCount - 1)));
  }

  const candidates: Array<{ trackStartIndex: number; ber: number }> = [];
  for (const start of starts) {
    const hit = bestProbeHit(video, track.subarray(start, start + probeItems));
    if (hit !== null) candidates.push({ trackStartIndex: hit.videoIndex - start, ber: hit.ber });
  }
  if (candidates.length === 0) return null;

  let bestCluster: Array<{ trackStartIndex: number; ber: number }> = [];
  for (const anchor of candidates) {
    const cluster = candidates.filter((c) => Math.abs(c.trackStartIndex - anchor.trackStartIndex) <= tolerance);
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }
  const startIndex = Math.round(bestCluster.reduce((s, c) => s + c.trackStartIndex, 0) / bestCluster.length);

  // Score the winning start over the whole overlap with the video.
  const from = Math.max(0, -startIndex);
  const to = Math.min(track.length, video.length - startIndex);
  if (to - from < probeItems) return null;
  const overlapBer = bitErrorRate(video, track.subarray(from, to), startIndex + from);
  if (overlapBer === null) return null;

  const bestProbeBer = Math.min(...bestCluster.map((c) => c.ber));
  const berScore = Math.max(0, Math.min(1, (0.5 - bestProbeBer) / 0.25));
  const agreement = bestCluster.length / candidates.length;
  const confidence = berScore * (0.5 + 0.5 * agreement);
  return {
    offsetSec: startIndex * FP_ITEM_SEC,
    confidence,
    bitErrorRate: overlapBer,
    method: "chromaprint",
  };
}

/** Pearson-normalised sliding correlation of `track` inside `video` (both energy envelopes). */
export function crossCorrelation(
  videoEnv: ArrayLike<number>,
  trackEnv: ArrayLike<number>,
  frameDurationSec: number,
): CorrelationMatch | null {
  const n = trackEnv.length;
  const m = videoEnv.length;
  if (n < 8 || m < n) return null;

  let trackSum = 0;
  let trackSq = 0;
  for (let i = 0; i < n; i++) {
    trackSum += trackEnv[i];
    trackSq += trackEnv[i] * trackEnv[i];
  }
  const trackMean = trackSum / n;
  const trackVar = trackSq - n * trackMean * trackMean;
  if (trackVar <= 1e-12) return null;

  const prefix = new Float64Array(m + 1);
  const prefixSq = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    prefix[i + 1] = prefix[i] + videoEnv[i];
    prefixSq[i + 1] = prefixSq[i] + videoEnv[i] * videoEnv[i];
  }

  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = 0; lag + n <= m; lag++) {
    const sum = prefix[lag + n] - prefix[lag];
    const sq = prefixSq[lag + n] - prefixSq[lag];
    const mean = sum / n;
    const variance = sq - n * mean * mean;
    if (variance <= 1e-12) continue;
    let cross = 0;
    for (let i = 0; i < n; i++) cross += videoEnv[lag + i] * trackEnv[i];
    const score = (cross - n * mean * trackMean) / Math.sqrt(variance * trackVar);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore <= 0) return null;
  return { offsetSec: bestLag * frameDurationSec, confidence: Math.min(1, bestScore), method: "cross-correlation" };
}
