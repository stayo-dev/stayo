/** Nearest room numbers by edit distance, for a mistyped room ("1O1" → "101"). */
export function nearestRoomNumbers(target: string, rooms: Array<{ room_no: string }>): string[] {
  const wanted = String(target || "").toUpperCase();
  return rooms
    .map((r) => r.room_no)
    .map((room_no) => ({ room_no, distance: editDistance(wanted, room_no.toUpperCase()) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((r) => r.room_no);
}

function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length];
}
