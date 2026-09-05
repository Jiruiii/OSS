# Energy raw samples

Each CSV is one measurement run. Columns: sample index, then power in mW
derived from the battery gauge as `|current_now| × voltage_now × 1e-9`
(`current_now` in µA, `voltage_now` in µV).

## Withdrawn: the 2026-09-05 measurement

`pixel7-scan-only-2026-09-05.csv` and
`pixel7-scan-plus-transfer-2026-09-05.csv` **did not measure the
application's power draw** and the figures derived from them (22.35 mW
scan-only, 26.78 mW scan+transfer, "+4.4 mW / ~20%", and a "1810 mW
connection spike") should not be cited. They are kept here only so the
correction is auditable.

The phone was on USB at or near full charge, so battery current was
oscillating around zero and the recorded values are the current sensor's
noise floor, not consumption. Three things establish this:

1. **The two conditions are statistically identical.** Both files have
   min 1.35 mW, p25 10.83 mW and median 20.31 mW — to the hundredth.
   Two genuinely different workloads cannot produce the same quartiles;
   the same near-zero noise sampled twice can.
2. **The values are physically implausible.** 22 mW is deep-sleep
   territory for a whole phone. A Pixel 7 with the screen merely off and
   nothing running measures ~340 mW on the same gauge (see below), and
   ~700-2000 mW with the screen on.
3. **The signature reproduces on demand.** A fully-charged, plugged-in
   Pixel 8a sampled today returns exactly this pattern — current
   alternating positive and negative (+5625, -4687, -1562, -9687, +7500,
   -28125 µA), giving 2.7-122 mW, which is the range and shape of both
   withdrawn files. The recurring "2.71 mW" sample is the gauge's
   quantisation step near zero (625 µA × 4.34 V), not a workload.

The "1810 mW spike" attributed to GATT connection setup was a single
charge/discharge transient of the same kind.

## Current measurement

Taken on the Pixel 7 at 85% battery reporting `Not charging`, so the
battery current is real discharge. Every sample records the charging
status alongside the reading and the analysis rejects the run if any
sample was taken while charging — the failure above is silent otherwise.

Conditions are interleaved (baseline, Emergency Mode, baseline, …) rather
than run as two blocks, so battery drift, temperature and background
system work land on both conditions equally instead of loading onto
whichever ran second. Results are reported as median and interquartile
range: the gauge has a heavy right tail from unrelated system wakeups,
and a mean over one 60-sample window is exactly what let a single
transient become a headline number last time.
