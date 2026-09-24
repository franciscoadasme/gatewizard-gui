/**
 * Pick physical RAM from Node `os` (bytes) over Chromium
 * `process.getSystemMemoryInfo` (KB). Chromium often caps total at 8 GiB.
 * @param {{ total?: number, free?: number } | null | undefined} osBytes
 * @param {{ total?: number, free?: number } | null | undefined} chromiumKb
 */
export function pickSystemMemorySample(osBytes, chromiumKb) {
  const osTotalKb = Math.max(0, Math.round(Number(osBytes?.total) / 1024) || 0)
  const osFreeKb = Math.max(0, Math.round(Number(osBytes?.free) / 1024) || 0)
  const crTotalKb = Math.max(0, Math.trunc(Number(chromiumKb?.total) || 0))
  const crFreeKb = Math.max(0, Math.trunc(Number(chromiumKb?.free) || 0))
  const totalKb = Math.max(osTotalKb, crTotalKb)
  const freeKb = osTotalKb >= crTotalKb ? osFreeKb : Math.max(osFreeKb, crFreeKb)
  return {
    totalKb,
    freeKb: Math.min(freeKb, totalKb)
  }
}

/**
 * Format physical-memory samples. Values are kibibytes.
 * @param {{ totalKb?: number, freeKb?: number } | null | undefined} info
 */
export function formatSystemRam(info) {
  const totalKb = Math.max(0, Number(info?.totalKb) || 0)
  const freeKb = Math.max(0, Number(info?.freeKb) || 0)
  const usedKb = Math.max(0, totalKb - freeKb)
  const usedGb = usedKb / (1024 * 1024)
  const totalGb = totalKb / (1024 * 1024)
  const freeGb = freeKb / (1024 * 1024)
  const fmt = (n) => n.toFixed(1)
  return {
    usedGb,
    totalGb,
    freeGb,
    low: freeGb < 2,
    label: `${fmt(usedGb)} / ${fmt(totalGb)} GB · ${fmt(freeGb)} free`
  }
}
