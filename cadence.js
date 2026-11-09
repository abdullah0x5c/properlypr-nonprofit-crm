export const offsets = [0, 2, 4, 7, 10, 14, 21];
export function sourceDay(value) {
  if (!value) return "";
  if (/^\d{4}-\d\d-\d\d/.test(value)) return value.slice(0, 10);
  const date = value.match(/^(\d\d?)\/(\d\d?)\/(\d{4})/);
  return date
    ? date[3] + "-" + date[1].padStart(2, "0") + "-" + date[2].padStart(2, "0")
    : "";
}
export function workday(day, n) {
  const d = new Date(day + "T12:00:00Z");
  const step = n < 0 ? -1 : 1;
  for (let remaining = Math.abs(n); remaining; ) {
    d.setUTCDate(d.getUTCDate() + step);
    if (![0, 6].includes(d.getUTCDay())) remaining--;
  }
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + step);
  return d.toISOString().slice(0, 10);
}
