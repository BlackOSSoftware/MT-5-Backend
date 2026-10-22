// Native candles -> bade MT5 timeframe (M2, M10, H3, H6 ...) me jodna.

/**
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number}[]} candles
 *   purane se naye (unix seconds)
 * @param {number} seconds target candle ki lambai
 */
export function aggregateCandles(candles, seconds) {
  const out = [];
  let cur = null;
  for (const k of candles) {
    const bucket = Math.floor(k.t / seconds) * seconds;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v };
      continue;
    }
    if (k.h > cur.h) cur.h = k.h;
    if (k.l < cur.l) cur.l = k.l;
    cur.c = k.c;
    cur.v += k.v;
  }
  if (cur) out.push(cur);
  return out;
}

/** Target ke liye kitne native candles chahiye (provider limit tak). */
export function baseCountFor({ limit, targetSeconds, baseSeconds, max }) {
  const ratio = Math.max(1, Math.round(targetSeconds / baseSeconds));
  // +1 bucket (pehla adhoora bucket katega) aur 1.5x - weekend / market
  // band hone wale gaps me bhi limit poora mile.
  return Math.min(max, Math.ceil((limit + 1) * ratio * 1.5));
}
