"use client";
// Áudio da ligação: WebRTC direto entre o navegador e o WhatsApp (a Meta só troca o SDP).

const ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

export async function getMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não permite ligações (use Chrome, Edge ou Safari atualizados).");
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch {
    throw new Error("Libere o microfone no navegador para ligar (ícone de cadeado ao lado do endereço).");
  }
}

export function createPeer(mic: MediaStream, onRemote: (s: MediaStream) => void): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" });
  mic.getAudioTracks().forEach((t) => pc.addTrack(t, mic));
  pc.ontrack = (e) => onRemote(e.streams[0] ?? new MediaStream([e.track]));
  return pc;
}

/** Espera juntar os candidatos de rede (a Meta recebe o SDP completo, sem trickle). */
export function waitIce(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(t); resolve(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    const t = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export async function makeOffer(pc: RTCPeerConnection): Promise<string> {
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  await waitIce(pc);
  return pc.localDescription?.sdp ?? offer.sdp ?? "";
}

export async function makeAnswer(pc: RTCPeerConnection, offerSdp: string): Promise<string> {
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIce(pc);
  return pc.localDescription?.sdp ?? answer.sdp ?? "";
}

/** Grava as duas vozes (atendente + cliente) num único arquivo, no navegador. */
export function startMixRecorder(mic: MediaStream, remote: MediaStream): { stop: () => Promise<Blob | null> } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(mic).connect(dest);
  ctx.createMediaStreamSource(remote).connect(dest);
  const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000);
  return {
    stop: () => new Promise((resolve) => {
      if (rec.state === "inactive") { void ctx.close(); return resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null); }
      rec.onstop = () => { void ctx.close(); resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null); };
      rec.stop();
    }),
  };
}

/** Toque de chamada (bipes curtos), enquanto o objeto viver. */
export function ringtone(): () => void {
  let ctx: AudioContext | null = null;
  try { ctx = new AudioContext(); } catch { return () => {}; }
  const beep = () => {
    if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.06;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.35);
  };
  beep();
  const t = setInterval(beep, 1500);
  return () => { clearInterval(t); void ctx?.close(); ctx = null; };
}

export const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
