export interface Fingerprint {
  /** Audio time (sec) at which the fingerprint was taken. */
  timeSec: number;
  /** Chromaprint raw fingerprint values. */
  hash: number[];
}

export interface FingerprintMatch {
  offsetSec: number;
  /** 0..1 fraction of track fingerprints explained by a consistent match. */
  confidence: number;
  method: "chromaprint";
}

export interface CorrelationMatch {
  offsetSec: number;
  /** 0..1 peak normalized cross-correlation. */
  confidence: number;
  method: "cross-correlation";
}

export type AudioMatch = FingerprintMatch | CorrelationMatch;

/** Hamming distance over aligned values; missing tail values count as zero. */
export function hammingDistance(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < len; i++) {
    const x = i < a.length ? a[i] : 0;
    const y = i < b.length ? b[i] : 0;
    let diff = x ^ y;
    let bits = 0;
    while (diff !== 0) {
      bits += diff & 1;
      diff = (diff >>> 1) & 0x7fffffff;
    }
    distance += bits;
  }
  return distance;
}

/**
 * Sliding fingerprint match: for every (video, track) fingerprint pair within
 * the Hamming distance threshold, vote for the candidate offset
 * (`video.timeSec - track.timeSec`). The offset with the strongest support wins.
 */
export function matchFingerprints(
  video: Fingerprint[],
  track: Fingerprint[],
  options: { maxDistance?: number; minVotes?: number } = {},
): FingerprintMatch | null {
  const maxDistance = options.maxDistance ?? 2;
  const minVotes = options.minVotes ?? 1;
  const votes = new Map<number, number>();
  let matchedPairs = 0;
  for (const v of video) {
    for (const t of track) {
      const distance = hammingDistance(v.hash, t.hash);
      if (distance > maxDistance) continue;
      matchedPairs++;
      const offset = v.timeSec - t.timeSec;
      const rounded = Math.round(offset * 100) / 100;
      votes.set(rounded, (votes.get(rounded) ?? 0) + 1);
    }
  }
  let bestOffset: number | null = null;
  let bestVotes = 0;
  for (const [offset, count] of votes) {
    if (count > bestVotes) {
      bestOffset = offset;
      bestVotes = count;
    }
  }
  if (bestOffset === null || bestVotes < minVotes) return null;
  const confidence = track.length === 0 ? 0 : Math.min(1, matchedPairs / track.length);
  return { offsetSec: bestOffset, confidence, method: "chromaprint" };
}

/**
 * Fallback alignment: normalized cross-correlation of downsampled mono energy
 * envelopes. Returns the peak lag and its normalized score.
 */
export function crossCorrelation(
  videoEnv: number[],
  trackEnv: number[],
  frameDurationSec: number,
): CorrelationMatch | null {
  const n = Math.min(videoEnv.length, trackEnv.length);
  if (n < 2) return null;
  const correlations: Array<{ lag: number; value: number }> = [];
  const maxLag = trackEnv.length - 1;
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    let sa = 0;
    let sb = 0;
    for (let i = 0; i + lag < trackEnv.length; i++) {
      const x = videoEnv[i];
      const y = trackEnv[i + lag];
      s += x * y;
      sa += x * x;
      sb += y * y;
    }
    const d = Math.sqrt(sa * sb);
    const value = d === 0 ? 0 : s / d;
    correlations.push({ lag, value });
  }
  correlations.sort((a, b) => b.value - a.value);
  const peak = correlations[0];
  if (peak.value <= 0) return null;
  return { offsetSec: peak.lag * frameDurationSec, confidence: Math.min(1, peak.value), method: "cross-correlation" };
}

/** Build a low-frequency energy envelope from mono samples. */
export function buildEnvelope(samples: number[], samplesPerSec: number, hertz = 4): number[] {
  const frameLen = Math.max(1, Math.round(samplesPerSec / hertz));
  const env: number[] = [];
  for (let i = 0; i < samples.length; i += frameLen) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < Math.min(i + frameLen, samples.length); j++) {
      sum += Math.abs(samples[j]);
      count++;
    }
    env.push(count === 0 ? 0 : sum / count);
  }
  return env;
}
