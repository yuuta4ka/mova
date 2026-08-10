import { useCallback, useEffect, useRef, useState } from 'react';
import { api, realtime, type AppUser, type RealtimeEvent } from '../lib/api';
import { loadAudioSettings, type AudioSettings } from '../lib/audioSettings';

export type CallState = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'error';
export interface ScreenShareQuality { width: number; height: number; frameRate: number }

type RemoteMediaKind = 'voice' | 'screen';
interface RemoteAudioEntry {
  userId: string;
  streamId: string;
  mediaKind: RemoteMediaKind;
  element: HTMLAudioElement;
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode | null;
  stopMonitor: () => void;
}

const incomingRingtoneUrl = new URL('../../ringtone.mp3', import.meta.url).href;
const outgoingRingtoneUrl = new URL('../../calling-sound.mp3', import.meta.url).href;
const activeCallKey = 'mova-active-call';
const pendingCallKey = 'mova-pending-call';
const participantVolumeKey = 'mova-call-participant-volumes';
const screenVolumeKey = 'mova-call-screen-volumes';

const clampVolume = (value: number) => Math.max(0, Math.min(200, Math.round(value)));
function loadVolumes(key: string): Record<string, number> {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    return Object.fromEntries(Object.entries(stored).map(([id, value]) => [id, clampVolume(Number(value))]));
  } catch { return {}; }
}
function storedCall(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
function setStoredCall(key: string, conversationId: string | null) { try { if (conversationId) sessionStorage.setItem(key, conversationId); else sessionStorage.removeItem(key); } catch {} }

function startRingtone(kind: 'incoming' | 'outgoing') {
  try {
    const audio = new Audio(kind === 'incoming' ? incomingRingtoneUrl : outgoingRingtoneUrl);
    let active = true;
    audio.loop = true;
    audio.volume = .58;
    void audio.play().catch(() => undefined);
    return () => {
      if (!active) return;
      active = false;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    };
  } catch { return () => undefined; }
}

function playControlTone(kind: 'mute' | 'unmute' | 'deafen' | 'undeafen') {
  try {
    const context = new AudioContext();
    const settings = loadAudioSettings();
    const setSinkId = (context as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (settings.outputDeviceId !== 'default' && setSinkId) void setSinkId.call(context, settings.outputDeviceId).catch(() => undefined);
    const frequencies = kind === 'mute' ? [520, 350] : kind === 'unmute' ? [350, 560] : kind === 'deafen' ? [570, 420, 300] : [300, 430, 590];
    const master = context.createGain();
    const level = Math.min(2, settings.outputVolume / 100) * .075;
    master.gain.setValueAtTime(level, context.currentTime);
    master.gain.linearRampToValueAtTime(0, context.currentTime + frequencies.length * .075 + .07);
    master.connect(context.destination);
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(master);
      oscillator.start(context.currentTime + index * .075);
      oscillator.stop(context.currentTime + (index + 1) * .075 + .025);
    });
    void context.resume();
    window.setTimeout(() => void context.close().catch(() => undefined), 700);
  } catch {}
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
    if (level > .035) lastVoiceAt = timestamp;
    const next = level > .035 || (active && timestamp - lastVoiceAt < 280);
    if (next !== active) { active = next; onChange(next); }
    animation = requestAnimationFrame(tick);
  };
  animation = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(animation); if (active) onChange(false); };
}

const fallbackIceServers: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];

export function useVoiceCall(conversationId: string | null, currentUserId?: string) {
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
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(() => loadVolumes(participantVolumeKey));
  const [screenVolumes, setScreenVolumes] = useState<Record<string, number>>(() => loadVolumes(screenVolumeKey));

  const stateRef = useRef<CallState>('idle');
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const localStream = useRef<MediaStream | null>(null);
  const localSourceStream = useRef<MediaStream | null>(null);
  const localAudioContext = useRef<AudioContext | null>(null);
  const localGain = useRef<GainNode | null>(null);
  const localVoiceMonitor = useRef<(() => void) | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const configuredIceServers = useRef<RTCIceServer[]>(fallbackIceServers);
  const iceConfigPromise = useRef<Promise<void> | null>(null);
  const remoteAudio = useRef(new Map<string, RemoteAudioEntry>());
  const remoteMediaRef = useRef<Record<string, { camera?: string; screen?: string }>>({});
  const participantVolumesRef = useRef(participantVolumes);
  const screenVolumesRef = useRef(screenVolumes);
  const pendingCandidates = useRef(new Map<string, RTCIceCandidateInit[]>());
  const makingOffer = useRef(new Map<string, boolean>());
  const ignoredOffers = useRef(new Set<string>());
  const negotiationQueues = useRef(new Map<string, Promise<void>>());
  const negotiateRef = useRef<(userId: string, restartIce?: boolean) => Promise<void>>(async () => undefined);
  const stopTone = useRef<() => void>(() => undefined);
  const ringTimeout = useRef<number | null>(null);

  const updateState = useCallback((next: CallState) => { stateRef.current = next; setState(next); }, []);
  const updateRemoteMedia = useCallback((updater: (items: Record<string, { camera?: string; screen?: string }>) => Record<string, { camera?: string; screen?: string }>) => {
    setRemoteMedia((items) => { const next = updater(items); remoteMediaRef.current = next; return next; });
  }, []);

  const unlockAudio = useCallback(() => {
    let context = localAudioContext.current;
    if (!context || context.state === 'closed') {
      context = new AudioContext();
      localAudioContext.current = context;
    }
    const settings = loadAudioSettings();
    const setSinkId = (context as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (settings.outputDeviceId !== 'default' && setSinkId) void setSinkId.call(context, settings.outputDeviceId).catch(() => undefined);
    void context.resume().catch(() => undefined);
    return context;
  }, []);

  const applyRemoteVolume = useCallback((entry: RemoteAudioEntry, settings = loadAudioSettings()) => {
    const scoped = entry.mediaKind === 'screen' ? screenVolumesRef.current[entry.userId] ?? 100 : participantVolumesRef.current[entry.userId] ?? 100;
    const volume = Math.max(0, Math.min(4, settings.outputVolume / 100 * scoped / 100));
    if (entry.gain) entry.gain.gain.value = deafenedRef.current ? 0 : volume;
    entry.element.volume = entry.gain || deafenedRef.current ? 0 : Math.min(1, volume);
    const sinkId = settings.outputDeviceId === 'default' ? '' : settings.outputDeviceId;
    const setSinkId = (entry.element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
    if (setSinkId) void setSinkId.call(entry.element, sinkId).catch(() => undefined);
  }, []);

  const removeRemoteAudio = useCallback((key: string) => {
    const entry = remoteAudio.current.get(key);
    if (!entry) return;
    entry.stopMonitor();
    entry.source?.disconnect();
    entry.gain?.disconnect();
    entry.element.pause();
    entry.element.srcObject = null;
    entry.element.remove();
    remoteAudio.current.delete(key);
  }, []);

  const attachRemoteTrack = useCallback((userId: string, event: RTCTrackEvent) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    if (event.track.kind === 'video') {
      setRemoteVideoStreams((items) => items.some((item) => item.userId === userId && item.streamId === stream.id) ? items : [...items, { userId, streamId: stream.id, stream }]);
      event.track.onended = () => setRemoteVideoStreams((items) => items.filter((item) => !(item.userId === userId && item.streamId === stream.id)));
      return;
    }

    const key = `${userId}:${stream.id}:${event.track.id}`;
    if (remoteAudio.current.has(key)) return;
    const element = new Audio();
    element.autoplay = true;
    element.style.display = 'none';
    document.body.append(element);
    const context = localAudioContext.current;
    let source: MediaStreamAudioSourceNode | null = null;
    let gain: GainNode | null = null;
    let stopMonitor: () => void = () => undefined;
    const mediaKind: RemoteMediaKind = remoteMediaRef.current[userId]?.screen === stream.id ? 'screen' : 'voice';
    if (context?.state === 'running') {
      source = context.createMediaStreamSource(new MediaStream([event.track]));
      gain = context.createGain();
      source.connect(gain).connect(context.destination);
      if (mediaKind === 'voice') {
        const analyser = context.createAnalyser();
        source.connect(analyser);
        stopMonitor = startVoiceActivityMonitor(analyser, (speaking) => {
          setSpeakingUsers((items) => speaking ? { ...items, [userId]: true } : Object.fromEntries(Object.entries(items).filter(([id]) => id !== userId)));
        });
      }
    } else element.srcObject = stream;

    const entry: RemoteAudioEntry = { userId, streamId: stream.id, mediaKind, element, gain, source, stopMonitor };
    remoteAudio.current.set(key, entry);
    applyRemoteVolume(entry);
    const play = () => {
      if (gain) return;
      void element.play().then(() => setError((value) => value.startsWith('Браузер заблокировал звук') ? '' : value)).catch(() => setError('Браузер заблокировал звук. Нажмите в любом месте страницы, чтобы включить его.'));
    };
    const retry = () => { void localAudioContext.current?.resume().catch(() => undefined); play(); };
    document.addEventListener('pointerdown', retry, { once: true });
    event.track.onended = () => {
      document.removeEventListener('pointerdown', retry);
      removeRemoteAudio(key);
      if (![...remoteAudio.current.values()].some((item) => item.userId === userId && item.mediaKind === 'voice')) setSpeakingUsers((items) => Object.fromEntries(Object.entries(items).filter(([id]) => id !== userId)));
    };
    play();
  }, [applyRemoteVolume, removeRemoteAudio]);

  const createPeer = useCallback((userId: string) => {
    const existing = peers.current.get(userId);
    if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: configuredIceServers.current });
    localStream.current?.getTracks().forEach((track) => peer.addTrack(track, localStream.current!));
    cameraStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, cameraStreamRef.current!));
    screenStreamRef.current?.getTracks().forEach((track) => peer.addTrack(track, screenStreamRef.current!));
    peer.onicecandidate = (event) => { if (event.candidate && conversationId) realtime.send({ type: 'voice:ice', conversationId, targetUserId: userId, candidate: event.candidate.toJSON() }); };
    peer.ontrack = (event) => attachRemoteTrack(userId, event);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') setError((value) => value.startsWith('Не удалось восстановить') ? '' : value);
      if (peer.connectionState === 'failed') void negotiateRef.current(userId, true).catch(() => setError('Не удалось восстановить медиасоединение. Проверьте сеть или настройте TURN-сервер.'));
      if (peer.connectionState === 'disconnected') window.setTimeout(() => { if (peer.connectionState === 'disconnected') void negotiateRef.current(userId, true); }, 2_500);
    };
    peers.current.set(userId, peer);
    setParticipants((items) => [...new Set([...items, userId])]);
    return peer;
  }, [attachRemoteTrack, conversationId]);

  const negotiatePeer = useCallback((userId: string, restartIce = false) => {
    const previous = negotiationQueues.current.get(userId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const peer = peers.current.get(userId);
      if (!peer || !conversationId || peer.signalingState === 'closed') return;
      if (peer.signalingState !== 'stable') return;
      makingOffer.current.set(userId, true);
      try {
        if (restartIce) peer.restartIce();
        const offer = await peer.createOffer({ iceRestart: restartIce });
        await peer.setLocalDescription(offer);
        realtime.send({ type: 'voice:offer', conversationId, targetUserId: userId, description: peer.localDescription || offer });
      } finally { makingOffer.current.set(userId, false); }
    });
    negotiationQueues.current.set(userId, next);
    return next;
  }, [conversationId]);
  negotiateRef.current = negotiatePeer;

  const announceLocalState = useCallback(() => {
    if (!conversationId) return;
    realtime.send({ type: 'voice:state', conversationId, muted: mutedRef.current, deafened: deafenedRef.current });
    const camera = cameraStreamRef.current; if (camera) realtime.send({ type: 'voice:media', conversationId, mediaKind: 'camera', enabled: true, streamId: camera.id });
    const screen = screenStreamRef.current; if (screen) realtime.send({ type: 'voice:media', conversationId, mediaKind: 'screen', enabled: true, streamId: screen.id });
  }, [conversationId]);

  const connectAudio = useCallback(async () => {
    if (!conversationId) return;
    if (localStream.current) {
      realtime.send({ type: 'voice:join', conversationId });
      announceLocalState();
      updateState('active');
      setStoredCall(activeCallKey, conversationId); setStoredCall(pendingCallKey, null);
      return;
    }
    try {
      updateState('connecting');
      setError('');
      if (!iceConfigPromise.current) iceConfigPromise.current = api.rtcConfig().then(({ iceServers }) => {
        if (iceServers.length) configuredIceServers.current = iceServers;
      }).catch(() => undefined);
      await iceConfigPromise.current;
      const settings = loadAudioSettings();
      const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: { ...(settings.inputDeviceId !== 'default' ? { deviceId: { exact: settings.inputDeviceId } } : {}), echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl }, video: false });
      const context = localAudioContext.current?.state === 'closed' ? new AudioContext() : localAudioContext.current || new AudioContext();
      const source = context.createMediaStreamSource(sourceStream);
      const analyser = context.createAnalyser();
      source.connect(analyser);
      localSourceStream.current = sourceStream;
      // Send the browser's microphone track directly. MediaStreamDestination can
      // produce a permanently silent sender when Web Audio is suspended even
      // though screen-share tracks in the same peer connection keep working.
      localStream.current = sourceStream;
      localAudioContext.current = context;
      localGain.current = null;
      localVoiceMonitor.current?.();
      localVoiceMonitor.current = startVoiceActivityMonitor(analyser, setLocalSpeaking);
      await context.resume().catch(() => undefined);
      realtime.send({ type: 'voice:join', conversationId });
      updateState('active');
      setStoredCall(activeCallKey, conversationId); setStoredCall(pendingCallKey, null);
    } catch (voiceError) {
      updateState('error');
      setError(voiceError instanceof Error ? voiceError.message : 'Нет доступа к микрофону');
    }
  }, [announceLocalState, conversationId, updateState]);

  const leave = useCallback((notify = true, preserveStoredCall = false) => {
    const previousState = stateRef.current;
    if (notify && conversationId && previousState !== 'idle') realtime.send({ type: 'call:end', conversationId });
    if (conversationId) realtime.send({ type: 'voice:leave', conversationId });
    peers.current.forEach((peer) => peer.close()); peers.current.clear();
    pendingCandidates.current.clear(); makingOffer.current.clear(); ignoredOffers.current.clear(); negotiationQueues.current.clear();
    [...remoteAudio.current.keys()].forEach(removeRemoteAudio);
    localVoiceMonitor.current?.(); localVoiceMonitor.current = null;
    stopTone.current();
    if (ringTimeout.current) window.clearTimeout(ringTimeout.current); ringTimeout.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop());
    localSourceStream.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    screenStreamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    localStream.current = null; localSourceStream.current = null; cameraStreamRef.current = null; screenStreamRef.current = null;
    setCameraStream(null); setScreenStream(null); setRemoteVideoStreams([]); updateRemoteMedia(() => ({})); setRemoteVoiceStates({});
    setLocalSpeaking(false); setSpeakingUsers({});
    if (localAudioContext.current?.state !== 'closed') void localAudioContext.current?.close().catch(() => undefined);
    localAudioContext.current = null; localGain.current = null;
    setParticipants([]); mutedRef.current = false; deafenedRef.current = false; setMuted(false); setDeafened(false); setIncomingFrom(null);
    updateState('idle'); setError('');
    if (!preserveStoredCall && conversationId) {
      if (storedCall(activeCallKey) === conversationId) setStoredCall(activeCallKey, null);
      if (storedCall(pendingCallKey) === conversationId) setStoredCall(pendingCallKey, null);
    }
  }, [conversationId, removeRemoteAudio, updateRemoteMedia, updateState]);

  useEffect(() => realtime.subscribe((event: RealtimeEvent) => {
    void (async () => {
      try {
        if (event.type === 'ready') {
          if (conversationId) realtime.send({ type: 'call:sync', conversationId });
          if (conversationId && localStream.current && stateRef.current === 'active') { realtime.send({ type: 'voice:join', conversationId }); announceLocalState(); }
          return;
        }
        if (!conversationId || !('conversationId' in event) || event.conversationId !== conversationId) return;
        if (event.type === 'call:state') {
          setParticipants((items) => [...new Set([...items, ...event.participants.filter((id) => id !== currentUserId)])]);
          if (event.status === 'idle') {
            if (stateRef.current !== 'idle') leave(false);
            if (storedCall(activeCallKey) === conversationId) setStoredCall(activeCallKey, null);
            if (storedCall(pendingCallKey) === conversationId) setStoredCall(pendingCallKey, null);
            return;
          }
          if (event.from) setIncomingFrom(event.from);
          if (event.status === 'ringing' && stateRef.current === 'idle') {
            const outgoing = Boolean(currentUserId && event.from?.id === currentUserId);
            updateState(outgoing ? 'ringing' : 'incoming');
            stopTone.current(); stopTone.current = startRingtone(outgoing ? 'outgoing' : 'incoming');
            return;
          }
          if (event.status === 'active' && !localStream.current) {
            if (storedCall(activeCallKey) === conversationId || storedCall(pendingCallKey) === conversationId || event.joined) await connectAudio();
            else if (stateRef.current === 'idle' || stateRef.current === 'ringing') updateState('incoming');
          }
          return;
        }
        if (event.type === 'call:invite' && stateRef.current === 'idle') { setIncomingFrom(event.from); updateState('incoming'); stopTone.current(); stopTone.current = startRingtone('incoming'); }
        if (event.type === 'call:accept' && stateRef.current === 'ringing') { stopTone.current(); if (ringTimeout.current) window.clearTimeout(ringTimeout.current); await connectAudio(); }
        if (event.type === 'call:decline' && ['ringing', 'incoming'].includes(stateRef.current)) leave(false);
        if (event.type === 'call:end') { if (stateRef.current !== 'idle') leave(false); else { if (storedCall(activeCallKey) === conversationId) setStoredCall(activeCallKey, null); if (storedCall(pendingCallKey) === conversationId) setStoredCall(pendingCallKey, null); } }
        if (event.type === 'voice:peers') {
          setParticipants((items) => [...new Set([...items, ...event.peers])]);
          for (const userId of event.peers) { createPeer(userId); await negotiatePeer(userId); }
          announceLocalState();
        }
        if (event.type === 'voice:offer') {
          const peer = createPeer(event.fromUserId);
          const collision = Boolean(makingOffer.current.get(event.fromUserId)) || peer.signalingState !== 'stable';
          const polite = !currentUserId || currentUserId.localeCompare(event.fromUserId) > 0;
          if (collision && !polite) { ignoredOffers.current.add(event.fromUserId); return; }
          ignoredOffers.current.delete(event.fromUserId);
          if (collision) await peer.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
          await peer.setRemoteDescription(event.description);
          for (const candidate of pendingCandidates.current.get(event.fromUserId) || []) await peer.addIceCandidate(candidate).catch(() => undefined);
          pendingCandidates.current.delete(event.fromUserId);
          const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
          realtime.send({ type: 'voice:answer', conversationId, targetUserId: event.fromUserId, description: peer.localDescription || answer });
        }
        if (event.type === 'voice:answer') {
          const peer = createPeer(event.fromUserId);
          if (peer.signalingState !== 'have-local-offer') return;
          await peer.setRemoteDescription(event.description);
          for (const candidate of pendingCandidates.current.get(event.fromUserId) || []) await peer.addIceCandidate(candidate).catch(() => undefined);
          pendingCandidates.current.delete(event.fromUserId);
        }
        if (event.type === 'voice:ice') {
          if (ignoredOffers.current.has(event.fromUserId)) return;
          const peer = createPeer(event.fromUserId);
          if (peer.remoteDescription) await peer.addIceCandidate(event.candidate).catch(() => undefined);
          else pendingCandidates.current.set(event.fromUserId, [...(pendingCandidates.current.get(event.fromUserId) || []), event.candidate]);
        }
        if (event.type === 'voice:media') {
          updateRemoteMedia((items) => ({ ...items, [event.fromUserId]: { ...items[event.fromUserId], [event.mediaKind]: event.enabled ? event.streamId : undefined } }));
          if (event.mediaKind === 'screen') for (const entry of remoteAudio.current.values()) if (entry.userId === event.fromUserId && entry.streamId === event.streamId) {
            entry.mediaKind = event.enabled ? 'screen' : 'voice';
            if (event.enabled) { entry.stopMonitor(); entry.stopMonitor = () => undefined; setSpeakingUsers((items) => Object.fromEntries(Object.entries(items).filter(([id]) => id !== event.fromUserId))); }
            applyRemoteVolume(entry);
          }
          if (!event.enabled && event.streamId) setRemoteVideoStreams((items) => items.filter((item) => !(item.userId === event.fromUserId && item.streamId === event.streamId)));
        }
        if (event.type === 'voice:state') setRemoteVoiceStates((items) => ({ ...items, [event.fromUserId]: { muted: event.muted, deafened: event.deafened } }));
        if (event.type === 'voice:joined') announceLocalState();
        if (event.type === 'voice:left') {
          peers.current.get(event.userId)?.close(); peers.current.delete(event.userId);
          [...remoteAudio.current.entries()].filter(([, entry]) => entry.userId === event.userId).forEach(([key]) => removeRemoteAudio(key));
          setRemoteVideoStreams((items) => items.filter((item) => item.userId !== event.userId));
          setSpeakingUsers((items) => Object.fromEntries(Object.entries(items).filter(([id]) => id !== event.userId)));
          setParticipants((items) => items.filter((id) => id !== event.userId));
          setRemoteVoiceStates((items) => { const next = { ...items }; delete next[event.userId]; return next; });
        }
      } catch (eventError) { setError(eventError instanceof Error ? eventError.message : 'Ошибка медиасоединения'); }
    })();
  }), [announceLocalState, applyRemoteVolume, connectAudio, conversationId, createPeer, currentUserId, leave, negotiatePeer, removeRemoteAudio, updateRemoteMedia, updateState]);

  useEffect(() => {
    if (conversationId) realtime.send({ type: 'call:sync', conversationId });
    return () => leave(false, true);
  }, [conversationId, leave]);

  useEffect(() => {
    const apply = (event: Event) => {
      const settings = (event as CustomEvent<AudioSettings>).detail;
      if (localGain.current) localGain.current.gain.value = settings.inputVolume / 100;
      const sourceTrack = localSourceStream.current?.getAudioTracks()[0];
      if (sourceTrack) void sourceTrack.applyConstraints({ echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl }).catch(() => undefined);
      remoteAudio.current.forEach((entry) => applyRemoteVolume(entry, settings));
    };
    window.addEventListener('mova-audio-settings', apply);
    return () => window.removeEventListener('mova-audio-settings', apply);
  }, [applyRemoteVolume]);

  const call = () => {
    if (!conversationId || stateRef.current !== 'idle') return;
    unlockAudio();
    updateState('ringing'); setIncomingFrom(null); setError(''); setStoredCall(pendingCallKey, conversationId);
    stopTone.current(); stopTone.current = startRingtone('outgoing');
    realtime.send({ type: 'call:invite', conversationId });
    ringTimeout.current = window.setTimeout(() => { realtime.send({ type: 'call:decline', conversationId }); leave(false); }, 30_000);
  };
  const accept = async () => {
    if (!conversationId || stateRef.current !== 'incoming') return;
    unlockAudio();
    stopTone.current(); setStoredCall(pendingCallKey, conversationId);
    realtime.send({ type: 'call:accept', conversationId }); setIncomingFrom(null); await connectAudio();
  };
  const decline = () => { if (conversationId) realtime.send({ type: 'call:decline', conversationId }); leave(false); };
  const toggleMute = () => {
    const next = !mutedRef.current;
    playControlTone(next ? 'mute' : 'unmute');
    if (deafenedRef.current && !next) { deafenedRef.current = false; setDeafened(false); remoteAudio.current.forEach((entry) => applyRemoteVolume(entry)); }
    mutedRef.current = next;
    localStream.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
    if (conversationId) realtime.send({ type: 'voice:state', conversationId, muted: next, deafened: deafenedRef.current });
  };
  const toggleDeafen = () => {
    const next = !deafenedRef.current;
    playControlTone(next ? 'deafen' : 'undeafen');
    deafenedRef.current = next; setDeafened(next);
    if (next) { mutedRef.current = true; setMuted(true); localStream.current?.getAudioTracks().forEach((track) => { track.enabled = false; }); }
    remoteAudio.current.forEach((entry) => applyRemoteVolume(entry));
    if (conversationId) realtime.send({ type: 'voice:state', conversationId, muted: mutedRef.current, deafened: next });
  };

  const renegotiateAll = async () => { await Promise.all([...peers.current.keys()].map((userId) => negotiatePeer(userId))); };
  const toggleCamera = async () => {
    if (!conversationId || stateRef.current !== 'active') return;
    if (cameraStreamRef.current) {
      const old = cameraStreamRef.current;
      peers.current.forEach((peer) => peer.getSenders().filter((sender) => sender.track && old.getTracks().includes(sender.track)).forEach((sender) => peer.removeTrack(sender)));
      old.getTracks().forEach((track) => { track.onended = null; track.stop(); }); cameraStreamRef.current = null; setCameraStream(null);
      realtime.send({ type: 'voice:media', conversationId, mediaKind: 'camera', enabled: false, streamId: old.id }); await renegotiateAll(); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
      cameraStreamRef.current = stream; setCameraStream(stream); peers.current.forEach((peer) => stream.getTracks().forEach((track) => peer.addTrack(track, stream)));
      realtime.send({ type: 'voice:media', conversationId, mediaKind: 'camera', enabled: true, streamId: stream.id });
      stream.getVideoTracks()[0].onended = () => void toggleCamera(); await renegotiateAll();
    } catch (cameraError) { setError(cameraError instanceof Error ? cameraError.message : 'Нет доступа к камере'); }
  };
  const stopScreen = async () => {
    if (!conversationId || !screenStreamRef.current) return;
    const old = screenStreamRef.current;
    peers.current.forEach((peer) => peer.getSenders().filter((sender) => sender.track && old.getTracks().includes(sender.track)).forEach((sender) => peer.removeTrack(sender)));
    old.getTracks().forEach((track) => { track.onended = null; track.stop(); }); screenStreamRef.current = null; setScreenStream(null);
    realtime.send({ type: 'voice:media', conversationId, mediaKind: 'screen', enabled: false, streamId: old.id }); await renegotiateAll();
  };
  const updateScreenQuality = async ({ width, height, frameRate }: ScreenShareQuality) => {
    const track = screenStreamRef.current?.getVideoTracks()[0]; if (!track) return;
    try { await track.applyConstraints({ width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, max: frameRate } }); setError(''); }
    catch (qualityError) { setError(qualityError instanceof Error ? qualityError.message : 'Не удалось изменить качество демонстрации'); }
  };
  const shareScreen = async ({ width, height, frameRate }: ScreenShareQuality = { width: 1920, height: 1080, frameRate: 30 }) => {
    if (!conversationId || stateRef.current !== 'active') return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, max: frameRate } }, audio: true });
      const old = screenStreamRef.current;
      if (old) {
        peers.current.forEach((peer) => peer.getSenders().filter((sender) => sender.track && old.getTracks().includes(sender.track)).forEach((sender) => peer.removeTrack(sender)));
        old.getTracks().forEach((track) => { track.onended = null; track.stop(); });
        realtime.send({ type: 'voice:media', conversationId, mediaKind: 'screen', enabled: false, streamId: old.id });
      }
      screenStreamRef.current = stream; setScreenStream(stream); peers.current.forEach((peer) => stream.getTracks().forEach((track) => peer.addTrack(track, stream)));
      realtime.send({ type: 'voice:media', conversationId, mediaKind: 'screen', enabled: true, streamId: stream.id });
      stream.getVideoTracks()[0].onended = () => void stopScreen(); await renegotiateAll();
      if (!stream.getAudioTracks().length) setError('Экран демонстрируется без звука. В окне выбора включите «Поделиться аудио» (звук доступен не для всех источников).');
      else setError('');
    } catch (screenError) { if (screenError instanceof DOMException && screenError.name === 'NotAllowedError') return; setError(screenError instanceof Error ? screenError.message : 'Не удалось показать экран'); }
  };

  const setParticipantVolume = (userId: string, value: number) => {
    const next = { ...participantVolumesRef.current, [userId]: clampVolume(value) }; participantVolumesRef.current = next; setParticipantVolumes(next);
    localStorage.setItem(participantVolumeKey, JSON.stringify(next)); remoteAudio.current.forEach((entry) => { if (entry.userId === userId && entry.mediaKind === 'voice') applyRemoteVolume(entry); });
  };
  const setScreenVolume = (userId: string, value: number) => {
    const next = { ...screenVolumesRef.current, [userId]: clampVolume(value) }; screenVolumesRef.current = next; setScreenVolumes(next);
    localStorage.setItem(screenVolumeKey, JSON.stringify(next)); remoteAudio.current.forEach((entry) => { if (entry.userId === userId && entry.mediaKind === 'screen') applyRemoteVolume(entry); });
  };

  return {
    state, muted, deafened, participants, error, incomingFrom, cameraStream, screenStream, remoteVideoStreams, remoteMedia, remoteVoiceStates,
    localSpeaking, speakingUsers, participantVolumes, screenVolumes, call, accept, decline, leave: () => leave(true), toggleMute, toggleDeafen,
    toggleCamera, toggleScreen: screenStreamRef.current ? stopScreen : shareScreen, shareScreen, stopScreen, updateScreenQuality, setParticipantVolume, setScreenVolume,
  };
}
