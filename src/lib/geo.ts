/** Lê "lat, lng" de um texto, link do Google Maps (@lat,lng / q=lat,lng / !3dlat!4dlng). */
export function parseCoords(text: string): { latitude: number; longitude: number } | null {
  const t = decodeURIComponent(text.trim());
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/];
  for (const p of pats) {
    const m = t.match(p);
    if (m) {
      const latitude = Number(m[1]), longitude = Number(m[2]);
      if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude };
    }
  }
  return null;
}
