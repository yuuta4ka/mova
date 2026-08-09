import { useCallback, useEffect, useRef, useState } from 'react';
import { realtime, type AppUser, type RealtimeEvent } from '../lib/api';
import { loadAudioSettings, type AudioSettings } from '../lib/audioSettings';

export type CallState = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'error';
export interface ScreenShareQuality { width: number; height: number; frameRate: number }

const incomingRingtoneUrl = new URL('../../ringtone.mp3', import.meta.url).href;
const outgoingRingtoneUrl = new URL('../../calling-sound.mp3', import.meta.url).href;

function startRingtone(kind: 'incoming' | 'outgoing') {
  try {
    const audio = new Audio(kind === 'incoming' ? incomingRingtoneUrl : outgoingRingtoneUrl); let active = true; audio.loop = true; audio.volume = .58; void audio.play().catch(() => undefined); return () => { if (!active) return; active = false; audio.pause(); audio.currentTime = 0; audio.removeAttribute('src'); audio.load(); };
  } catch { return () => undefined; }
}

function startVoiceActivityMonitor(analyser: AnalyserNode, onChange: (speaking: boolean) => void) {
  analyser.fftSize = 512;
  const samples = new Uint8Array(analyser.fftSize);
  let animation = 0;
  let active = false;
  let lastVoiceAt = 0;
  const tick = (timestamp: number) => {
    analyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (const sample of samples) { const normalized = (sample - 128) / 128; energy += normalized * normalized; }
    const level = Math.sqrt(energy / samples.length);
    if (level > .045) lastVoiceAt = timestamp;
    const next = level > .045 || (active && timestamp - lastVoiceAt < 260);
    if (next !== active) { active = next; onChange(next); }
    animation = requestAnimationFrame(tick);
  };
  animation = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(animation); if (active) onChange(false); };
}

export function useVoiceCall(conversationId: string | null) {
  const [state, setState] = useState<CallState>('idle');
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [incomingFrom, setIncomingFrom] = useState<AppUser | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Array<{ userId: string; streamId: string; stream: MediaStream }>>([]);
  const [remoteMedia, setRemoteMedia] = useState<Record<string, { camera?: string; screen?: string }>>({});
  const [remoteVoiceStates, setRemoteVoiceStates] = useState<Record<string, { muted: boolean; deafened: boolean }>>({});
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>({});
  const stateRef = useRef<CallState>('idle');
  const mutedRef = useRef(false); const deafenedRef = useRef(false);
  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const remoteAudio = useRef(new Map<string, { element: HTMLAudioElement; stopMonitor: () => void }>());
  const localVoiceMonitor = useRef<(() => void) | null>(null);
  const localSourceStream = useRef<MediaStream | null>(null);
  const localAudioContext = useRef<AudioContext | null>(null);
  const localGain = useRef<GainNode | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef(new Map<string, RTCIceCandidateInit[]>());
  const stopTone = useRef<() => void>(() => undefined);
  const ringTimeout = useRef<number | null>(null);
  const updateState = (next: CallState) => { stateRef.current = next; setState(next); };

  const createPeer = useCallback((userId: string) => {
    const existing = peers.current.get(userId); if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStream.current?.getTracks().forEach((track) => peer.addTrack(track, localStream.current!));
    cameraStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, cameraStreamRef.current!));
    screenStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, screenStreamRef.current!));
    peer.onicecandidate = (event) => { if (event.candidate && conversationId) realtime.send({ type: 'voice:ice', conversationId, targetUserId: userId, candidate: event.candidate.toJSON() }); };
    peer.onconnectionstatechange = () => { if (peer.connectionState === 'failed') setError('Не удалось передать звук между сетями. Для этого соединения нужен TURN-сервер.'); };
    peer.ontrack = async (event) => { if (event.track.kind === 'video') { const stream = event.streams[0] || new MediaStream([event.track]); setRemoteVideoStreams((items) => items.some((item) => item.userId === userId && item.streamId === stream.id) ? items : [...items, { userId, streamId: stream.id, stream }]); event.track.onended = () => setRemoteVideoStreams((items) => items.filter((item) => item.streamId !== stream.id)); return; } if (remoteAudio.current.has(userId)) return; const settings = loadAudioSettings(); const stream = event.streams[0] || new MediaStream([event.track]); const element = new Audio(); element.autoplay = true; element.volume = settings.outputVolume / 100; element.srcObject = stream; element.style.display = 'none'; document.body.append(element); const setSinkId = (element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId; if (settings.outputDeviceId !== 'default' && setSinkId) await setSinkId.call(element, settings.outputDeviceId).catch(() => undefined); const context = localAudioContext.current; let stopMonitor: () => void = () => undefined; if (context) { const source = context.createMediaStreamSource(new MediaStream([event.track])); const analyser = context.createAnalyser(); source.connect(analyser); stopMonitor = startVoiceActivityMonitor(analyser, (speaking) => setSpeakingUsers((items) => speaking ? { ...items, [userId]: true } : Object.fromEntries(Object.entries(items).filter(([id]) => id !== userId)))); } remoteAudio.current.set(userId, { element, stopMonitor }); const play = () => void element.play().then(() => setError((value) => value.startsWith('Браузер заблокировал звук') ? '' : value)).catch(() => setError('Браузер заблокировал звук. Нажмите в любом месте страницы, чтобы включить его.')); const retry = () => play(); document.addEventListener('pointerdown', retry, { once: true }); event.track.onended = () => { document.removeEventListener('pointerdown', retry); const audio = remoteAudio.current.get(userId); audio?.stopMonitor(); if (audio) { audio.element.pause(); audio.element.srcObject = null; audio.element.remove(); } remoteAudio.current.delete(userId); setSpeakingUsers((items) => Object.fromEntries(Object.entries(items).filter(([id]) => id !== userId))); }; play(); };
    peers.current.set(userId, peer); setParticipants((items) => [...new Set([...items, userId])]); return peer;
  }, [conversationId]);

  const leave = useCallback((notify = true) => {
    if (notify && conversationId && stateRef.current === 'active') realtime.send({ type: 'call:end', conversationId });
    if (conversationId) realtime.send({ type: 'voice:leave', conversationId });
    peers.current.forEach((peer) => peer.close()); peers.current.clear(); pendingCandidates.current.clear(); remoteAudio.current.forEach(({ element, stopMonitor }) => { stopMonitor(); element.pause(); element.srcObject = null; element.remove(); }); remoteAudio.current.clear(); localVoiceMonitor.current?.(); localVoiceMonitor.current = null;
    stopTone.current(); if (ringTimeout.current) window.clearTimeout(ringTimeout.current); ringTimeout.current = null; localStream.current?.getTracks().forEach((track) => track.stop()); localSourceStream.current?.getTracks().forEach((track) => track.stop()); cameraStreamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); }); screenStreamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); }); localStream.current = null; localSourceStream.current = null; cameraStreamRef.current = null; screenStreamRef.current = null; setCameraStream(null); setScreenStream(null); setRemoteVideoStreams([]); setRemoteMedia({}); setRemoteVoiceStates({}); setLocalSpeaking(false); setSpeakingUsers({}); if (localAudioContext.current?.state !== 'closed') void localAudioContext.current?.close().catch(() => undefined); localAudioContext.current = null; localGain.current = null; setParticipants([]); mutedRef.current = false; deafenedRef.current = false; setMuted(false); setDeafened(false); setIncomingFrom(null); updateState('idle'); setError('');
  }, [conversationId]);

  const connectAudio = useCallback(async () => { if (!conversationId || localStream.current) return; try { updateState('connecting'); setError(''); const settings = loadAudioSettings(); const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: { ...(settings.inputDeviceId !== 'default' ? { deviceId: { exact: settings.inputDeviceId } } : {}), echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl }, video: false }); localSourceStream.current = sourceStream; localStream.current = sourceStream; const context = new AudioContext(); const source = context.createMediaStreamSource(sourceStream); const analyser = context.createAnalyser(); source.connect(analyser); localVoiceMonitor.current?.(); localVoiceMonitor.current = startVoiceActivityMonitor(analyser, setLocalSpeaking); localAudioContext.current = context; localGain.current = null; realtime.send({ type: 'voice:join', conversationId }); updateState('active'); } catch (voiceError) { updateState('error'); setError(voiceError instanceof Error ? voiceError.message : 'Нет доступа к микрофону'); } }, [conversationId]);

  useEffect(() => realtime.subscribe(async (event: RealtimeEvent) => {
    if (!conversationId || !('conversationId' in event) || event.conversationId !== conversationId) return;
    if (event.type === 'call:invite' && stateRef.current === 'idle') { setIncomingFrom(event.from); updateState('incoming'); stopTone.current(); stopTone.current = startRingtone('incoming'); }
    if (event.type === 'call:accept' && stateRef.current === 'ringing') { stopTone.current(); if (ringTimeout.current) window.clearTimeout(ringTimeout.current); await connectAudio(); }
    if (event.type === 'call:decline' && ['ringing', 'incoming'].includes(stateRef.current)) { stopTone.current(); setIncomingFrom(null); updateState('idle'); }
    if (event.type === 'call:end' && stateRef.current === 'active') leave(false);
    if (event.type === 'voice:peers') for (const userId of event.peers) { const peer = createPeer(userId); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); realtime.send({ type: 'voice:offer', conversationId, targetUserId: userId, description: offer }); }
    if (event.type === 'voice:offer') { const peer = createPeer(event.fromUserId); if (peer.signalingState !== 'stable') try { await peer.setLocalDescription({ type: 'rollback' }); } catch {} await peer.setRemoteDescription(event.description); for (const candidate of pendingCandidates.current.get(event.fromUserId) || []) await peer.addIceCandidate(candidate); pendingCandidates.current.delete(event.fromUserId); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); realtime.send({ type: 'voice:answer', conversationId, targetUserId: event.fromUserId, description: answer }); }
    if (event.type === 'voice:answer') { const peer = createPeer(event.fromUserId); if (peer.signalingState !== 'have-local-offer') return; await peer.setRemoteDescription(event.description); for (const candidate of pendingCandidates.current.get(event.fromUserId) || []) await peer.addIceCandidate(candidate); pendingCandidates.current.delete(event.fromUserId); }
    if (event.type === 'voice:ice') { const peer = createPeer(event.fromUserId); if (peer.remoteDescription) try { await peer.addIceCandidate(event.candidate); } catch {} else pendingCandidates.current.set(event.fromUserId, [...(pendingCandidates.current.get(event.fromUserId) || []), event.candidate]); }
    if (event.type === 'voice:media') { setRemoteMedia((items) => ({ ...items, [event.fromUserId]: { ...items[event.fromUserId], [event.mediaKind]: event.enabled ? event.streamId : undefined } })); if (!event.enabled && event.streamId) setRemoteVideoStreams((items) => items.filter((item) => item.streamId !== event.streamId)); }
    if (event.type === 'voice:state') setRemoteVoiceStates((items) => ({ ...items, [event.fromUserId]: { muted: event.muted, deafened: event.deafened } }));
    if (event.type === 'voice:joined') realtime.send({ type: 'voice:state', conversationId, muted: mutedRef.current, deafened: deafenedRef.current });
    if (event.type === 'voice:left') { peers.current.get(event.userId)?.close(); peers.current.delete(event.userId); const audio = remoteAudio.current.get(event.userId); audio?.stopMonitor(); if (audio) { audio.element.pause(); audio.element.srcObject = null; audio.element.remove(); } remoteAudio.current.delete(event.userId); setSpeakingUsers((items) => Object.fromEntries(Object.entries(items).filter(([id]) => id !== event.userId))); setParticipants((items) => items.filter((id) => id !== event.userId)); setRemoteVoiceStates((items) => { const next = { ...items }; delete next[event.userId]; return next; }); }
  }), [conversationId, createPeer, connectAudio, leave]);

  useEffect(() => leave, [leave]);
  useEffect(() => { const apply = (event: Event) => { const settings = (event as CustomEvent<AudioSettings>).detail; if (localGain.current) localGain.current.gain.value = settings.inputVolume / 100; remoteAudio.current.forEach(({ element }) => { element.volume = settings.outputVolume / 100; const setSinkId = (element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId; if (settings.outputDeviceId !== 'default' && setSinkId) void setSinkId.call(element, settings.outputDeviceId).catch(() => undefined); }); }; window.addEventListener('mova-audio-settings', apply); return () => window.removeEventListener('mova-audio-settings', apply); }, []);
  const call = () => { if (!conversationId || stateRef.current !== 'idle') return; updateState('ringing'); stopTone.current = startRingtone('outgoing'); realtime.send({ type: 'call:invite', conversationId }); ringTimeout.current = window.setTimeout(() => { stopTone.current(); realtime.send({ type: 'call:decline', conversationId }); updateState('idle'); }, 30_000); };
  const accept = async () => { if (!conversationId || stateRef.current !== 'incoming') return; stopTone.current(); realtime.send({ type: 'call:accept', conversationId }); setIncomingFrom(null); await connectAudio(); };
  const decline = () => { if (conversationId) realtime.send({ type: 'call:decline', conversationId }); leave(); };
  const toggleMute = () => { const next = !muted; if (deafenedRef.current && !next) { deafenedRef.current = false; setDeafened(false); remoteAudio.current.forEach(({ element }) => { element.volume = loadAudioSettings().outputVolume / 100; }); } mutedRef.current = next; localStream.current?.getAudioTracks().forEach((track) => { track.enabled = !next; }); setMuted(next); if (conversationId) realtime.send({ type: 'voice:state', conversationId, muted: next, deafened: deafenedRef.current }); };
  const toggleDeafen = () => { const next = !deafened; deafenedRef.current = next; setDeafened(next); remoteAudio.current.forEach(({ element }) => { element.volume = next ? 0 : loadAudioSettings().outputVolume / 100; }); if (next) { mutedRef.current = true; setMuted(true); localStream.current?.getAudioTracks().forEach((track) => { track.enabled = false; }); } if (conversationId) realtime.send({ type: 'voice:state', conversationId, muted: mutedRef.current, deafened: next }); };
  const renegotiate = async () => { if (!conversationId) return; for (const [userId, peer] of peers.current) { const offer = await peer.createOffer(); await peer.setLocalDescription(offer); realtime.send({ type: 'voice:offer', conversationId, targetUserId: userId, description: offer }); } };
  const toggleCamera = async () => { if (!conversationId || stateRef.current !== 'active') return; if (cameraStreamRef.current) { const old = cameraStreamRef.current; peers.current.forEach((peer) => peer.getSenders().filter((sender) => old.getTracks().includes(sender.track!)).forEach((sender) => peer.removeTrack(sender))); old.getTracks().forEach((track) => { track.onended = null; track.stop(); }); cameraStreamRef.current = null; setCameraStream(null); realtime.send({ type: 'voice:media', conversationId, mediaKind: 'camera', enabled: false, streamId: old.id }); await renegotiate(); return; } try { const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false }); cameraStreamRef.current = stream; setCameraStream(stream); peers.current.forEach((peer) => stream.getTracks().forEach((track) => peer.addTrack(track, stream))); realtime.send({ type: 'voice:media', conversationId, mediaKind: 'camera', enabled: true, streamId: stream.id }); stream.getVideoTracks()[0].onended = () => void toggleCamera(); await renegotiate(); } catch (cameraError) { setError(cameraError instanceof Error ? cameraError.message : 'Нет доступа к камере'); } };
  const stopScreen = async () => { if (!conversationId || !screenStreamRef.current) return; const old = screenStreamRef.current; peers.current.forEach((peer) => peer.getSenders().filter((sender) => old.getTracks().includes(sender.track!)).forEach((sender) => peer.removeTrack(sender))); old.getTracks().forEach((track) => { track.onended = null; track.stop(); }); screenStreamRef.current = null; setScreenStream(null); realtime.send({ type: 'voice:media', conversationId, mediaKind: 'screen', enabled: false, streamId: old.id }); await renegotiate(); };
  const updateScreenQuality = async ({ width, height, frameRate }: ScreenShareQuality) => { const track = screenStreamRef.current?.getVideoTracks()[0]; if (!track) return; try { await track.applyConstraints({ width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, max: frameRate } }); setError(''); } catch (qualityError) { setError(qualityError instanceof Error ? qualityError.message : 'Не удалось изменить качество демонстрации'); } };
  const shareScreen = async ({ width, height, frameRate }: ScreenShareQuality = { width: 1920, height: 1080, frameRate: 30 }) => { if (!conversationId || stateRef.current !== 'active') return; try { const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, max: frameRate } }, audio: false }); const old = screenStreamRef.current; if (old) { peers.current.forEach((peer) => peer.getSenders().filter((sender) => old.getTracks().includes(sender.track!)).forEach((sender) => peer.removeTrack(sender))); old.getTracks().forEach((track) => { track.onended = null; track.stop(); }); realtime.send({ type: 'voice:media', conversationId, mediaKind: 'screen', enabled: false, streamId: old.id }); } screenStreamRef.current = stream; setScreenStream(stream); peers.current.forEach((peer) => stream.getTracks().forEach((track) => peer.addTrack(track, stream))); realtime.send({ type: 'voice:media', conversationId, mediaKind: 'screen', enabled: true, streamId: stream.id }); stream.getVideoTracks()[0].onended = () => void stopScreen(); await renegotiate(); } catch (screenError) { if (screenError instanceof DOMException && screenError.name === 'NotAllowedError') return; setError(screenError instanceof Error ? screenError.message : 'Не удалось показать экран'); } };
  return { state, muted, deafened, participants, error, incomingFrom, cameraStream, screenStream, remoteVideoStreams, remoteMedia, remoteVoiceStates, localSpeaking, speakingUsers, call, accept, decline, leave: () => leave(true), toggleMute, toggleDeafen, toggleCamera, toggleScreen: screenStreamRef.current ? stopScreen : shareScreen, shareScreen, stopScreen, updateScreenQuality };
}
