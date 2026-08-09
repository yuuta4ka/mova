import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCheck, ChevronDown, ChevronUp, Clock, Download, EyeOff, FileText, Gamepad2, Headphones, LogOut, Maximize2, Menu, MessageCircle, Mic, MicOff, Minimize2, MonitorUp, Moon, MoreHorizontal, Paperclip, Pencil, Phone, PhoneOff, Plus, Search, Send, Settings, Smile, Sparkles, Upload, Users, Video, VideoOff, Volume2, X } from 'lucide-react';
import { api, realtime, session, type AppConversation, type AppMessage, type AppUser, type MessageAttachment, type RealtimeEvent } from './lib/api';
import { useVoiceCall, type ScreenShareQuality } from './hooks/useVoiceCall';
import { Avatar, Button, IconButton } from './components/Primitives';
import { defaultAudioSettings, loadAudioSettings, saveAudioSettings, type AudioSettings } from './lib/audioSettings';

const avatarStatus = (presence: AppUser['presence']) => presence;
const readImage = (file?: File) => new Promise<string>((resolve, reject) => { if (!file) return resolve(''); const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
const activityTime = (startedAt?: string) => { if (!startedAt) return ''; const minutes = Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)); if (minutes < 60) return `${minutes} мин.`; const hours = Math.floor(minutes / 60); return `${hours} ч. ${minutes % 60} мин.`; };
const messageSoundUrl = new URL('../sound-message.mp3', import.meta.url).href;

function MessageStatus({ message, conversation }: { message: AppMessage; conversation: AppConversation }) {
  if (!message.sentAt) return null;
  const recipients = conversation.members.filter((member) => member.id !== message.authorId);
  const readCount = recipients.filter((member) => message.readBy?.some((receipt) => receipt.userId === member.id)).length;
  const allRead = recipients.length > 0 && readCount === recipients.length;
  const label = allRead ? (recipients.length === 1 ? 'Прочитано' : 'Прочитано всеми') : readCount ? `Прочитано: ${readCount} из ${recipients.length}` : 'Отправлено';
  return <span className={`mova-message-status ${allRead ? 'is-read' : readCount ? 'is-partially-read' : 'is-sent'}`} role="img" aria-label={label} title={label}>{readCount ? <CheckCheck size={13} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}</span>;
}

function ProfileEditor({ user, open, onClose, onSaved }: { user: AppUser; open: boolean; onClose: () => void; onSaved: (user: AppUser) => void }) {
  const [form, setForm] = useState({ name: user.name, handle: user.handle, bio: user.bio || '', avatarDataUrl: user.avatarDataUrl || '', bannerDataUrl: user.bannerDataUrl || '', activityName: user.activity?.name || '' }); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  useEffect(() => { if (open) setForm({ name: user.name, handle: user.handle, bio: user.bio || '', avatarDataUrl: user.avatarDataUrl || '', bannerDataUrl: user.bannerDataUrl || '', activityName: user.activity?.name || '' }); }, [open, user]);
  if (!open) return null;
  const save = async () => { setLoading(true); setError(''); try { const result = await api.updateProfile({ name: form.name, handle: form.handle.startsWith('@') ? form.handle : `@${form.handle}`, bio: form.bio, avatarDataUrl: form.avatarDataUrl, bannerDataUrl: form.bannerDataUrl, activity: form.activityName.trim() ? { name: form.activityName.trim(), startedAt: user.activity?.name === form.activityName.trim() ? user.activity.startedAt : new Date().toISOString() } : null }); onSaved(result.user); onClose(); } catch (profileError) { setError(profileError instanceof Error ? profileError.message : 'Не удалось сохранить профиль'); } finally { setLoading(false); } };
  return <div className="mova-real-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="mova-glass-card mova-profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-title"><header><div><h2 id="profile-title">Ваш профиль</h2><p>Так вас видят другие пользователи Mova</p></div><IconButton label="Закрыть" onClick={onClose}><X size={18} /></IconButton></header><div className="mova-profile-preview"><div className="mova-profile-banner" style={form.bannerDataUrl ? { backgroundImage: `url(${form.bannerDataUrl})` } : undefined}><label><Upload size={14} />Изменить шапку<input type="file" accept="image/*" onChange={async (event) => setForm({ ...form, bannerDataUrl: await readImage(event.target.files?.[0]) })} /></label></div><div className="mova-profile-avatar-edit"><Avatar name={form.name || user.name} src={form.avatarDataUrl} color={user.color} size="xl" status={avatarStatus(user.presence)} /><label aria-label="Изменить аватар"><Pencil size={14} /><input type="file" accept="image/*" onChange={async (event) => setForm({ ...form, avatarDataUrl: await readImage(event.target.files?.[0]) })} /></label></div></div><div className="mova-profile-form"><label><span>Отображаемое имя</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Как к вам обращаться" /></label><label><span>Уникальный юзернейм</span><input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value.toLowerCase() })} placeholder="@username" /><small>По нему вас можно найти. Начинается с @.</small></label><label className="is-wide"><span>О себе</span><textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} placeholder="Пара слов о себе" maxLength={240} /></label><label className="is-wide"><span>Текущая активность</span><div className="mova-activity-input"><Gamepad2 size={17} /><input value={form.activityName} onChange={(event) => setForm({ ...form, activityName: event.target.value })} placeholder="Например, играет в Minecraft" /></div><small>В веб-версии активность указывается вручную.</small></label></div>{error && <div className="mova-auth-error">{error}</div>}<footer><Button variant="ghost" onClick={onClose}>Отмена</Button><Button loading={loading} onClick={save}>Сохранить профиль</Button></footer></section></div>;
}

function SettingsModal({ user, open, onClose, onEditProfile }: { user: AppUser; open: boolean; onClose: () => void; onEditProfile: () => void }) {
  const [section, setSection] = useState<'profile' | 'audio'>('audio');
  const [settings, setSettings] = useState<AudioSettings>(defaultAudioSettings);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]); const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState(''); const [testing, setTesting] = useState(false); const [level, setLevel] = useState(0); const testStream = useRef<MediaStream | null>(null); const testContext = useRef<AudioContext | null>(null); const animation = useRef<number | null>(null);
  const outputSelectionSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const stopTest = useCallback(() => { if (animation.current) cancelAnimationFrame(animation.current); animation.current = null; testStream.current?.getTracks().forEach((track) => track.stop()); testStream.current = null; void testContext.current?.close(); testContext.current = null; setTesting(false); setLevel(0); }, []);
  const refreshDevices = useCallback(async (askPermission = false) => { if (!navigator.mediaDevices) return setDeviceError('Устройства недоступны в этом браузере'); try { setDeviceError(''); if (askPermission) { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); } const devices = await navigator.mediaDevices.enumerateDevices(); setInputs(devices.filter((device) => device.kind === 'audioinput')); setOutputs(devices.filter((device) => device.kind === 'audiooutput')); } catch (error) { setDeviceError(error instanceof Error ? error.message : 'Нет доступа к аудиоустройствам'); } }, []);
  useEffect(() => { if (open) { setSettings(loadAudioSettings()); void refreshDevices(false); } else stopTest(); }, [open, refreshDevices, stopTest]);
  useEffect(() => () => stopTest(), [stopTest]);
  if (!open) return null;
  const startTest = async () => { if (testing) return stopTest(); try { setDeviceError(''); const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(settings.inputDeviceId !== 'default' ? { deviceId: { exact: settings.inputDeviceId } } : {}), noiseSuppression: settings.noiseSuppression, echoCancellation: settings.echoCancellation, autoGainControl: settings.autoGainControl } }); testStream.current = stream; const context = new AudioContext(); testContext.current = context; const analyser = context.createAnalyser(); analyser.fftSize = 256; const gain = context.createGain(); gain.gain.value = settings.inputVolume / 100; context.createMediaStreamSource(stream).connect(gain).connect(analyser); const data = new Uint8Array(analyser.frequencyBinCount); setTesting(true); const tick = () => { analyser.getByteFrequencyData(data); setLevel(Math.min(100, Math.round(data.reduce((sum, value) => sum + value, 0) / data.length * 1.6))); animation.current = requestAnimationFrame(tick); }; tick(); } catch (error) { setDeviceError(error instanceof Error ? error.message : 'Не удалось включить микрофон'); } };
  const testOutput = async () => { try { const context = new AudioContext(); const setSinkId = (context as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId; if (settings.outputDeviceId !== 'default' && setSinkId) await setSinkId.call(context, settings.outputDeviceId); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 520; gain.gain.value = Math.min(2, settings.outputVolume / 100) * .12; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .45); window.setTimeout(() => void context.close(), 700); } catch (error) { setDeviceError(error instanceof Error ? error.message : 'Не удалось воспроизвести звук'); } };
  const save = () => { saveAudioSettings(settings); stopTest(); onClose(); };
  return <div className="mova-real-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="mova-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title"><aside><div><span>M</span><strong>Настройки</strong></div><button type="button" className={section === 'profile' ? 'is-active' : ''} onClick={() => setSection('profile')}><Pencil size={17} />Профиль</button><button type="button" className={section === 'audio' ? 'is-active' : ''} onClick={() => setSection('audio')}><Headphones size={17} />Голос и звук</button></aside><main><header><div><h2 id="settings-title">{section === 'profile' ? 'Профиль' : 'Голос и звук'}</h2><p>{section === 'profile' ? 'Отображение вашего аккаунта' : 'Устройства и обработка голоса'}</p></div><IconButton label="Закрыть настройки" onClick={onClose}><X size={18} /></IconButton></header>{section === 'profile' ? <div className="mova-settings-profile"><div className="mova-settings-profile__banner" style={user.bannerDataUrl ? { backgroundImage: `url(${user.bannerDataUrl})` } : undefined} /><Avatar name={user.name} src={user.avatarDataUrl} color={user.color} size="xl" status={avatarStatus(user.presence)} /><h3>{user.name}</h3><span>{user.handle}</span>{user.bio && <p>{user.bio}</p>}<Button leadingIcon={<Pencil size={16} />} onClick={() => { onClose(); onEditProfile(); }}>Настроить профиль</Button></div> : <div className="mova-audio-settings"><section><h3><Mic size={18} />Микрофон</h3><label><span>Устройство ввода</span><select value={settings.inputDeviceId} onChange={(event) => setSettings({ ...settings, inputDeviceId: event.target.value })}><option value="default">Системный микрофон</option>{inputs.filter((device) => device.deviceId !== 'default').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Микрофон ${index + 1}`}</option>)}</select></label><RangeSetting label="Громкость микрофона" value={settings.inputVolume} onChange={(inputVolume) => setSettings({ ...settings, inputVolume })} /><div className="mova-mic-test"><Button variant={testing ? 'danger' : 'secondary'} size="sm" onClick={() => void startTest()}>{testing ? 'Остановить тест' : 'Проверить микрофон'}</Button><i><span style={{ width: `${level}%` }} /></i></div></section><section><h3><Headphones size={18} />Вывод звука</h3><label><span>Наушники или динамики</span><select value={settings.outputDeviceId} disabled={!outputSelectionSupported} onChange={(event) => setSettings({ ...settings, outputDeviceId: event.target.value })}><option value="default">Системное устройство</option>{outputs.filter((device) => device.deviceId !== 'default').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Устройство ${index + 1}`}</option>)}</select></label>{!outputSelectionSupported && <small>Выбор выхода не поддерживается этим браузером — используется системное устройство.</small>}<RangeSetting label="Громкость собеседников" value={settings.outputVolume} onChange={(outputVolume) => setSettings({ ...settings, outputVolume })} /><Button variant="secondary" size="sm" leadingIcon={<Volume2 size={15} />} onClick={() => void testOutput()}>Проверить звук</Button></section><section><h3><Sparkles size={18} />Обработка голоса</h3><ToggleSetting label="Шумоподавление" description="Убирает постоянный фоновый шум" checked={settings.noiseSuppression} onChange={(noiseSuppression) => setSettings({ ...settings, noiseSuppression })} /><ToggleSetting label="Эхоподавление" description="Не даёт звуку из наушников вернуться в микрофон" checked={settings.echoCancellation} onChange={(echoCancellation) => setSettings({ ...settings, echoCancellation })} /><ToggleSetting label="Автоматическое усиление" description="Выравнивает слишком тихий и громкий голос" checked={settings.autoGainControl} onChange={(autoGainControl) => setSettings({ ...settings, autoGainControl })} /></section><Button variant="ghost" size="sm" onClick={() => void refreshDevices(true)}>Обновить список устройств</Button>{deviceError && <div className="mova-auth-error">{deviceError}</div>}</div>}<footer><Button variant="ghost" onClick={onClose}>Отмена</Button><Button onClick={save}>Сохранить настройки</Button></footer></main></section></div>;
}

function RangeSetting({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="mova-range-setting"><span>{label}<b>{value}%</b></span><input type="range" min="0" max="200" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>; }
function ToggleSetting({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="mova-toggle-setting"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>; }

function AccountMenu({ user, open, onClose, onEdit, onSettings, onUpdated, onLogout }: { user: AppUser; open: boolean; onClose: () => void; onEdit: () => void; onSettings: () => void; onUpdated: (user: AppUser) => void; onLogout: () => void }) {
  const [dndOpen, setDndOpen] = useState(false); const [, setActivityTick] = useState(0); useEffect(() => { if (!open || !user.activity) return; const timer = window.setInterval(() => setActivityTick((value) => value + 1), 60_000); return () => window.clearInterval(timer); }, [open, user.activity]); if (!open) return null;
  const setPresence = async (presence: AppUser['presence'], duration?: number | 'forever') => { const dndUntil = presence === 'dnd' ? duration === 'forever' || !duration ? 'forever' : new Date(Date.now() + duration).toISOString() : null; const result = await api.updatePresence(presence, dndUntil); onUpdated(result.user); onClose(); };
  const durations: Array<[string, number | 'forever']> = [['15 минут', 15 * 60000], ['1 час', 60 * 60000], ['8 часов', 8 * 3600000], ['24 часа', 24 * 3600000], ['3 дня', 3 * 86400000], ['Навсегда', 'forever']];
  return <div className="mova-account-menu mova-glass-card"><div className="mova-account-profile">{user.bannerDataUrl && <div style={{ backgroundImage: `url(${user.bannerDataUrl})` }} />}<Avatar name={user.name} src={user.avatarDataUrl} color={user.color} size="lg" status={avatarStatus(user.presence)} /><span><strong>{user.name}</strong><small>{user.handle}</small></span></div>{user.activity && <div className="mova-current-activity"><Gamepad2 size={16} /><span><strong>{user.activity.name}</strong><small>уже {activityTime(user.activity.startedAt)}</small></span></div>}<button type="button" onClick={() => void setPresence('online')}><i className="online" /><span>В сети</span>{user.presence === 'online' && <Check size={14} />}</button><button type="button" onClick={() => void setPresence('idle')}><i className="idle" /><span>Отошёл</span>{user.presence === 'idle' && <Check size={14} />}</button><button type="button" onClick={() => setDndOpen(!dndOpen)}><i className="dnd" /><span>Не беспокоить</span><ChevronDown size={14} /></button>{dndOpen && <div className="mova-dnd-options">{durations.map(([label, duration]) => <button type="button" key={label} onClick={() => void setPresence('dnd', duration)}><Clock size={13} />{label}</button>)}</div>}<button type="button" onClick={() => void setPresence('invisible')}><EyeOff size={15} /><span>Невидимый</span>{user.presence === 'invisible' && <Check size={14} />}</button><div className="mova-account-menu__divider" /><button type="button" onClick={() => { onSettings(); onClose(); }}><Settings size={15} /><span>Настройки</span></button><button type="button" onClick={() => { onEdit(); onClose(); }}><Pencil size={15} /><span>Редактировать профиль</span></button><button type="button" onClick={onLogout}><LogOut size={15} /><span>Выйти</span></button></div>;
}

function AuthScreen({ onAuth }: { onAuth: (user: AppUser) => void }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setLoading(true); setError(''); try { const result = mode === 'register' ? await api.register(form) : await api.login(form); session.set(result.token); onAuth(result.user); } catch (authError) { setError(authError instanceof Error ? authError.message : 'Не удалось войти'); } finally { setLoading(false); } };
  return <main className="mova-auth"><div className="mova-auth__aurora" /><section className="mova-auth__intro"><div className="mova-auth__brand"><span>M</span>Mova</div><div><span className="mova-auth__eyebrow"><Sparkles size={14} />Ваше место для разговоров</span><h1>Ближе к тем,<br />кто действительно важен.</h1><p>Личные чаты, пространства для своих и голос — в одном спокойном месте.</p></div><div className="mova-auth__quote"><div className="mova-auth__faces"><span>Л</span><span>М</span><span>А</span></div><p>«Здесь хочется не листать, а разговаривать»</p></div></section><section className="mova-auth__panel"><div className="mova-glass-card mova-auth-card"><header><h2>{mode === 'register' ? 'Создать аккаунт' : 'С возвращением'}</h2><p>{mode === 'register' ? 'Займёт меньше минуты' : 'Войдите, чтобы продолжить разговор'}</p></header><form onSubmit={submit}>{mode === 'register' && <label><span>Как вас зовут</span><input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ваше имя" autoComplete="name" /></label>}<label><span>Почта</span><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@example.com" autoComplete="email" /></label><label><span>Пароль</span><input required minLength={8} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Не менее 8 символов" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /></label>{error && <div className="mova-auth-error">{error}</div>}<Button type="submit" size="lg" loading={loading}>{mode === 'register' ? 'Начать общение' : 'Войти в Mova'}</Button></form><footer>{mode === 'register' ? 'Уже есть аккаунт?' : 'Впервые в Mova?'} <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>{mode === 'register' ? 'Войти' : 'Создать аккаунт'}</button></footer></div></section></main>;
}

function ConversationAvatar({ conversation, currentUser }: { conversation: AppConversation; currentUser: AppUser }) {
  if (conversation.kind === 'group') return <span className="mova-real-group-avatar"><Users size={19} /></span>;
  const person = conversation.members.find((member) => member.id !== currentUser.id) ?? currentUser;
  return <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} status={avatarStatus(person.presence)} size="lg" />;
}

function CreateConversation({ open, users, onClose, onCreated }: { open: boolean; users: AppUser[]; onClose: () => void; onCreated: (conversation: AppConversation) => void }) {
  const [kind, setKind] = useState<'direct' | 'group'>('group'); const [title, setTitle] = useState(''); const [selected, setSelected] = useState<string[]>([]); const [memberQuery, setMemberQuery] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  useEffect(() => { if (open) { setTitle(''); setSelected([]); setMemberQuery(''); setError(''); } }, [open]);
  if (!open) return null;
  const create = async () => { setLoading(true); setError(''); try { const result = await api.createConversation({ kind, title, memberIds: kind === 'direct' ? selected.slice(0, 1) : selected }); onCreated(result.conversation); onClose(); } catch (createError) { setError(createError instanceof Error ? createError.message : 'Не удалось создать чат'); } finally { setLoading(false); } };
  const visibleUsers = users.filter((user) => `${user.name} ${user.handle}`.toLocaleLowerCase().includes(memberQuery.toLocaleLowerCase()));
  return <div className="mova-real-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="mova-glass-card mova-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><header><div><h2 id="create-title">Новый разговор</h2><p>Соберите своих людей в одном месте</p></div><IconButton label="Закрыть" onClick={onClose}><X size={19} /></IconButton></header><div className="mova-create-tabs"><button type="button" className={kind === 'direct' ? 'is-active' : ''} onClick={() => { setKind('direct'); setSelected((items) => items.slice(0, 1)); }}><MessageCircle size={16} />Личный чат</button><button type="button" className={kind === 'group' ? 'is-active' : ''} onClick={() => setKind('group')}><Users size={16} />Группа</button></div>{kind === 'group' && <label className="mova-create-name"><span>Название</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Поездка на Урал" /></label>}<label className="mova-create-search"><Search size={15} /><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Найти по имени или @username" /></label><div className="mova-create-members"><span>{kind === 'group' ? 'Участники' : 'Собеседник'}</span>{users.length === 0 ? <div className="mova-no-users">Других пользователей пока нет. Зарегистрируйте второй аккаунт в новой вкладке.</div> : visibleUsers.length === 0 ? <div className="mova-no-users">Пользователь не найден</div> : visibleUsers.map((user) => { const active = selected.includes(user.id); return <button type="button" key={user.id} className={active ? 'is-active' : ''} onClick={() => setSelected((items) => kind === 'direct' ? [user.id] : active ? items.filter((id) => id !== user.id) : [...items, user.id])}><Avatar name={user.name} src={user.avatarDataUrl} color={user.color} status={avatarStatus(user.presence)} size="sm" /><span><strong>{user.name}</strong><small>{user.handle}</small></span><i>{active && <Check size={14} />}</i></button>; })}</div>{error && <div className="mova-auth-error">{error}</div>}<footer><Button variant="ghost" onClick={onClose}>Отмена</Button><Button loading={loading} disabled={!selected.length || (kind === 'group' && title.trim().length < 2)} onClick={create}>{kind === 'group' ? 'Создать группу' : 'Начать чат'}</Button></footer></section></div>;
}

function LegacyVoiceCallBar({ conversation, currentUser, onOpenSettings = () => window.dispatchEvent(new Event('mova-open-settings')) }: { conversation: AppConversation; currentUser: AppUser; onOpenSettings?: () => void }) {
  const call = useVoiceCall(conversation.id);
  const [moreOpen, setMoreOpen] = useState(false); const [showSelf, setShowSelf] = useState(true); const [showNoVideo, setShowNoVideo] = useState(true);
  const [screenMenuOpen, setScreenMenuOpen] = useState(false); const [screenQuality, setScreenQuality] = useState<ScreenShareQuality>({ width: 1920, height: 1080, frameRate: 30 });
  if (call.state === 'idle') return <Button variant="secondary" size="sm" aria-label="Позвонить" leadingIcon={<Phone size={16} />} onClick={call.call}>Позвонить</Button>;
  if (call.state === 'incoming') return <div className="mova-call-bar incoming"><span className="mova-call-pulse"><i /><Phone size={15} /></span><span><strong>Входящий звонок</strong><small>{call.incomingFrom?.name || conversation.title}</small></span><IconButton label="Принять звонок" className="mova-accept-call" onClick={call.accept}><Phone size={17} /></IconButton><IconButton label="Отклонить звонок" className="mova-hangup" onClick={call.decline}><PhoneOff size={17} /></IconButton></div>;
  const ringing = call.state === 'ringing';
  if (call.state === 'active') { const localCamera = call.cameraStream; const localScreen = call.screenStream; const remoteTiles = call.remoteVideoStreams.map((item) => ({ ...item, kind: call.remoteMedia[item.userId]?.screen === item.streamId ? 'screen' as const : 'camera' as const })); const remoteWithVideo = new Set(remoteTiles.map((item) => item.userId)); return <section className="mova-call-stage"><header><span><strong>{conversation.title}</strong><small>Голосовой разговор</small></span></header><div className="mova-call-grid">{localScreen && <CallVideoTile stream={localScreen} label="Ваш экран" kind="screen" muted={call.muted} deafened={call.deafened} />}{showSelf && (localCamera ? <CallVideoTile stream={localCamera} label={`${currentUser.name} · вы`} mirrored kind="camera" muted={call.muted} deafened={call.deafened} /> : !localScreen && <CallAvatarTile user={currentUser} label={`${currentUser.name} · вы`} muted={call.muted} deafened={call.deafened} />)}{remoteTiles.map((tile) => { const user = conversation.members.find((member) => member.id === tile.userId); const voice = call.remoteVoiceStates[tile.userId]; return <CallVideoTile key={`${tile.userId}-${tile.streamId}`} stream={tile.stream} label={`${user?.name || 'Участник'}${tile.kind === 'screen' ? ' · экран' : ''}`} kind={tile.kind} muted={voice?.muted} deafened={voice?.deafened} />; })}{showNoVideo && call.participants.filter((id) => !remoteWithVideo.has(id)).map((id) => { const user = conversation.members.find((member) => member.id === id); const voice = call.remoteVoiceStates[id]; return user ? <CallAvatarTile key={id} user={user} label={user.name} muted={voice?.muted} deafened={voice?.deafened} /> : null; })}</div><div className="mova-call-controls"><button type="button" className={call.muted ? 'is-off' : ''} onClick={call.toggleMute} aria-label={call.muted ? 'Включить микрофон' : 'Выключить микрофон'}>{call.muted ? <MicOff size={21} /> : <Mic size={21} />}<span>Микрофон</span></button><button type="button" className={localCamera ? 'is-on' : ''} onClick={() => void call.toggleCamera()} aria-label={localCamera ? 'Выключить камеру' : 'Включить камеру'}>{localCamera ? <Video size={21} /> : <VideoOff size={21} />}<span>Камера</span></button><button type="button" className={localScreen ? 'is-on' : ''} onClick={() => void call.toggleScreen()} aria-label={localScreen ? 'Остановить демонстрацию' : 'Показать экран'}><MonitorUp size={21} /><span>Экран</span></button><button type="button" className={moreOpen ? 'is-on' : ''} onClick={() => setMoreOpen(!moreOpen)} aria-label="Дополнительно"><MoreHorizontal size={21} /><span>Ещё</span></button><button type="button" className="is-hangup" onClick={call.leave} aria-label="Завершить звонок"><PhoneOff size={22} /><span>Завершить</span></button></div>{moreOpen && <div className="mova-call-more"><label><span>Табличный вид</span><input type="checkbox" checked readOnly /><i /></label><label><span>Показывать мою камеру</span><input type="checkbox" checked={showSelf} onChange={(event) => setShowSelf(event.target.checked)} /><i /></label><label><span>Показывать участников без видео</span><input type="checkbox" checked={showNoVideo} onChange={(event) => setShowNoVideo(event.target.checked)} /><i /></label><button type="button" onClick={call.toggleDeafen}>{call.deafened ? <Headphones size={18} /> : <Volume2 size={18} />}<span>{call.deafened ? 'Включить входящий звук' : 'Выключить входящий звук'}</span>{call.deafened && <Check size={16} />}</button><div /><button type="button" onClick={() => { setMoreOpen(false); onOpenSettings(); }}><Settings size={18} /><span>Настройки голоса и видео</span></button></div>}{call.error && <div className="mova-call-error">{call.error}</div>}</section>; }
  return <div className={`mova-call-bar ${call.state}`}><span className="mova-call-pulse"><i /><Phone size={15} /></span><span><strong>{ringing ? 'Вызываем…' : call.state === 'connecting' ? 'Подключаем…' : call.state === 'error' ? 'Не удалось подключить' : 'Голосовой звонок'}</strong><small>{call.error || (ringing ? conversation.title : `${call.participants.length + 1} в разговоре`)}</small></span><IconButton label="Завершить звонок" className="mova-hangup" onClick={ringing ? call.decline : call.leave}><PhoneOff size={17} /></IconButton></div>;
}

function VoiceCallBar({ conversation, currentUser, chatOpen, onToggleChat, onCallStateChange, onOpenSettings = () => window.dispatchEvent(new Event('mova-open-settings')) }: { conversation: AppConversation; currentUser: AppUser; chatOpen: boolean; onToggleChat: () => void; onCallStateChange: (open: boolean) => void; onOpenSettings?: () => void }) {
  const call = useVoiceCall(conversation.id);
  const [stageHost, setStageHost] = useState<HTMLElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [screenMenuOpen, setScreenMenuOpen] = useState(false);
  const [showSelf, setShowSelf] = useState(true);
  const [showNoVideo, setShowNoVideo] = useState(true);
  const [screenQuality, setScreenQuality] = useState<ScreenShareQuality>({ width: 1920, height: 1080, frameRate: 30 });
  useEffect(() => { setStageHost(document.querySelector('.mova-open-chat > .mova-call-host')); }, [conversation.id]);
  useEffect(() => { if (!call.screenStream) setScreenMenuOpen(false); }, [call.screenStream]);
  useEffect(() => { onCallStateChange(call.state !== 'idle'); }, [call.state, onCallStateChange]);

  if (call.state === 'idle') return <Button variant="secondary" size="sm" aria-label="Позвонить" leadingIcon={<Phone size={16} />} onClick={call.call}>Позвонить</Button>;
  if (call.state !== 'active') return stageHost ? createPortal(<PendingCallStage
    state={call.state}
    conversation={conversation}
    currentUser={currentUser}
    caller={call.incomingFrom}
    error={call.error}
    onAccept={call.accept}
    onEnd={call.state === 'ringing' || call.state === 'incoming' ? call.decline : call.leave}
  />, stageHost) : null;

  if (call.state === 'active') {
    const localCamera = call.cameraStream;
    const localScreen = call.screenStream;
    const remoteTiles = call.remoteVideoStreams.map((item) => ({ ...item, kind: call.remoteMedia[item.userId]?.screen === item.streamId ? 'screen' as const : 'camera' as const }));
    const screenTiles = remoteTiles.filter((tile) => tile.kind === 'screen');
    const cameraTiles = remoteTiles.filter((tile) => tile.kind === 'camera');
    const remoteWithCamera = new Set(cameraTiles.map((item) => item.userId));
    const hasScreen = Boolean(localScreen || screenTiles.length);
    const participantTiles = <>{showSelf && (localCamera ? <CallVideoTile stream={localCamera} label={`${currentUser.name} · вы`} mirrored kind="camera" muted={call.muted} deafened={call.deafened} /> : !localScreen && <CallAvatarTile user={currentUser} label={`${currentUser.name} · вы`} muted={call.muted} deafened={call.deafened} />)}{cameraTiles.map((tile) => { const user = conversation.members.find((member) => member.id === tile.userId); const voice = call.remoteVoiceStates[tile.userId]; return <CallVideoTile key={`${tile.userId}-${tile.streamId}`} stream={tile.stream} label={user?.name || 'Участник'} kind="camera" muted={voice?.muted} deafened={voice?.deafened} />; })}{showNoVideo && call.participants.filter((id) => !remoteWithCamera.has(id)).map((id) => { const user = conversation.members.find((member) => member.id === id); const voice = call.remoteVoiceStates[id]; return user ? <CallAvatarTile key={id} user={user} label={user.name} muted={voice?.muted} deafened={voice?.deafened} /> : null; })}</>;

    return stageHost ? createPortal(<section className="mova-call-stage">
      <header><span><strong>{conversation.title}</strong><small>Голосовой разговор</small></span><button type="button" className={`mova-call-chat-toggle ${chatOpen ? 'is-active' : ''}`} onClick={onToggleChat} aria-label={chatOpen ? 'Закрыть чат' : 'Открыть чат'} aria-pressed={chatOpen}><MessageCircle size={20} /><span>{chatOpen ? 'Скрыть чат' : 'Открыть чат'}</span></button></header>
      {hasScreen ? <div className="mova-call-grid has-screen"><div className="mova-call-screen-area">{localScreen && <CallVideoTile stream={localScreen} label="Ваш экран" kind="screen" muted={call.muted} deafened={call.deafened} />}{screenTiles.map((tile) => { const user = conversation.members.find((member) => member.id === tile.userId); return <CallVideoTile key={`${tile.userId}-${tile.streamId}`} stream={tile.stream} label={`${user?.name || 'Участник'} · экран`} kind="screen" />; })}</div><div className="mova-call-participants">{participantTiles}</div></div> : <div className="mova-call-grid">{participantTiles}</div>}
      <div className="mova-call-controls">
        <button type="button" className={call.muted ? 'is-off' : ''} onClick={call.toggleMute} aria-label={call.muted ? 'Включить микрофон' : 'Выключить микрофон'}>{call.muted ? <MicOff size={21} /> : <Mic size={21} />}<span>Микрофон</span></button>
        <button type="button" className={localCamera ? 'is-on' : ''} onClick={() => void call.toggleCamera()} aria-label={localCamera ? 'Выключить камеру' : 'Включить камеру'}>{localCamera ? <Video size={21} /> : <VideoOff size={21} />}<span>Камера</span></button>
        <button type="button" className={localScreen ? 'is-on' : ''} onClick={() => { if (localScreen) { setScreenMenuOpen((open) => !open); setMoreOpen(false); } else void call.shareScreen(screenQuality); }} aria-label={localScreen ? 'Настроить демонстрацию' : 'Показать экран'}><MonitorUp size={21} /><span>Экран</span></button>
        <button type="button" className={moreOpen ? 'is-on' : ''} onClick={() => { setMoreOpen((open) => !open); setScreenMenuOpen(false); }} aria-label="Дополнительно"><MoreHorizontal size={21} /><span>Ещё</span></button>
        <button type="button" className="is-hangup" onClick={call.leave} aria-label="Завершить звонок"><PhoneOff size={22} /><span>Завершить</span></button>
      </div>
      {screenMenuOpen && localScreen && <ScreenShareMenu quality={screenQuality} onQualityChange={setScreenQuality} onApply={() => { void call.updateScreenQuality(screenQuality); setScreenMenuOpen(false); }} onChangeWindow={() => { void call.shareScreen(screenQuality); setScreenMenuOpen(false); }} onStop={() => { void call.stopScreen(); setScreenMenuOpen(false); }} />}
      {moreOpen && <div className="mova-call-more"><label><span>Табличный вид</span><input type="checkbox" checked readOnly /><i /></label><label><span>Показывать мою камеру</span><input type="checkbox" checked={showSelf} onChange={(event) => setShowSelf(event.target.checked)} /><i /></label><label><span>Показывать участников без видео</span><input type="checkbox" checked={showNoVideo} onChange={(event) => setShowNoVideo(event.target.checked)} /><i /></label><button type="button" onClick={call.toggleDeafen}>{call.deafened ? <Headphones size={18} /> : <Volume2 size={18} />}<span>{call.deafened ? 'Включить входящий звук' : 'Выключить входящий звук'}</span>{call.deafened && <Check size={16} />}</button><div /><button type="button" onClick={() => { setMoreOpen(false); onOpenSettings(); }}><Settings size={18} /><span>Настройки голоса и видео</span></button></div>}
      {call.error && <div className="mova-call-error">{call.error}</div>}
    </section>, stageHost) : null;
  }

}

export function PendingCallStage({ state, conversation, currentUser, caller, error, onAccept, onEnd }: {
  state: 'ringing' | 'incoming' | 'connecting' | 'error';
  conversation: AppConversation;
  currentUser: AppUser;
  caller: AppUser | null;
  error?: string;
  onAccept: () => void;
  onEnd: () => void;
}) {
  const other = conversation.members.find((member) => member.id !== currentUser.id);
  const person = state === 'incoming' ? caller || other : other;
  const incoming = state === 'incoming';
  const title = incoming ? person?.name || conversation.title : conversation.title;
  const eyebrow = incoming ? 'Входящий звонок' : state === 'ringing' ? 'Исходящий звонок' : state === 'connecting' ? 'Подключение' : 'Не удалось позвонить';
  const description = error || (incoming
    ? conversation.kind === 'group' && person ? `${person.name} звонит в «${conversation.title}»` : 'Ответьте, чтобы начать разговор'
    : state === 'ringing'
      ? conversation.kind === 'group' ? 'Ждём ответа участников…' : `Ждём, когда ${person?.name || 'собеседник'} ответит…`
      : state === 'connecting' ? 'Собеседник ответил. Устанавливаем соединение…' : 'Попробуйте позвонить ещё раз');
  const meta = conversation.kind === 'direct' ? person?.handle : `${Math.max(1, conversation.members.length - 1)} ${conversation.members.length - 1 === 1 ? 'собеседник' : 'собеседника'}`;

  return <section className={`mova-call-stage mova-call-pending is-${state}`} aria-live="polite" aria-label={eyebrow}>
    <header><span><strong>Голосовой звонок</strong><small>{conversation.kind === 'group' ? conversation.title : 'Mova'}</small></span></header>
    <div className="mova-call-pending__content">
      <div className="mova-call-pending__avatar">
        <i aria-hidden="true" />
        {person ? <Avatar name={person.name} src={person.avatarDataUrl} color={person.color} size="xl" initialsLength={1} /> : <ConversationAvatar conversation={conversation} currentUser={currentUser} />}
        <span><Phone size={20} /></span>
      </div>
      <span className="mova-call-pending__status"><i aria-hidden="true" />{eyebrow}</span>
      <h1>{title}</h1>
      {meta && <small>{meta}</small>}
      <p>{description}</p>
    </div>
    <div className="mova-call-pending__actions">
      {incoming && <button type="button" className="is-accept" onClick={onAccept}><Phone size={25} /><span>Принять</span></button>}
      <button type="button" className="is-decline" onClick={onEnd}><PhoneOff size={25} /><span>{incoming ? 'Отклонить' : state === 'error' ? 'Закрыть' : 'Отменить'}</span></button>
    </div>
  </section>;
}

function ScreenShareMenu({ quality, onQualityChange, onApply, onChangeWindow, onStop }: { quality: ScreenShareQuality; onQualityChange: (quality: ScreenShareQuality) => void; onApply: () => void; onChangeWindow: () => void; onStop: () => void }) {
  const resolution = `${quality.width}x${quality.height}`;
  return <div className="mova-screen-menu" role="dialog" aria-label="Настройки демонстрации"><header><strong>Демонстрация экрана</strong><small>Настройте качество или выберите другое окно</small></header><div className="mova-screen-quality"><label><span>Разрешение</span><select value={resolution} onChange={(event) => { const [width, height] = event.target.value.split('x').map(Number); onQualityChange({ ...quality, width, height }); }}><option value="1280x720">720p</option><option value="1920x1080">1080p</option><option value="2560x1440">1440p</option></select></label><label><span>FPS</span><select value={quality.frameRate} onChange={(event) => onQualityChange({ ...quality, frameRate: Number(event.target.value) })}><option value={15}>15</option><option value={30}>30</option><option value={60}>60</option></select></label></div><button type="button" onClick={onApply}>Применить качество</button><button type="button" onClick={onChangeWindow}>Сменить окно</button><div /><button type="button" className="is-danger" onClick={onStop}>Выключить демонстрацию</button></div>;
}

function CallVideoTile({ stream, label, kind, mirrored = false, muted, deafened }: { stream: MediaStream; label: string; kind: 'camera' | 'screen'; mirrored?: boolean; muted?: boolean; deafened?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLElement>(null);
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const [expanded, setExpanded] = useState(false);
  const [screenRatio, setScreenRatio] = useState(settings?.aspectRatio || (settings?.width && settings?.height ? settings.width / settings.height : 16 / 9));
  const [screenSize, setScreenSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => undefined); } }, [stream, expanded]);
  useEffect(() => {
    if (kind !== 'screen' || expanded || !tileRef.current?.parentElement) return;
    const area = tileRef.current.parentElement;
    const fitToArea = () => {
      const bounds = area.getBoundingClientRect();
      const tileCount = Math.max(1, area.childElementCount);
      const availableWidth = Math.max(0, (bounds.width - (tileCount - 1) * 9) / tileCount);
      const availableHeight = Math.max(0, bounds.height);
      if (!availableWidth || !availableHeight || !screenRatio) return;
      const widthLimited = availableWidth / availableHeight <= screenRatio;
      setScreenSize(widthLimited
        ? { width: availableWidth, height: availableWidth / screenRatio }
        : { width: availableHeight * screenRatio, height: availableHeight });
    };
    fitToArea();
    const observer = new ResizeObserver(fitToArea);
    observer.observe(area);
    return () => observer.disconnect();
  }, [kind, screenRatio, expanded]);
  useEffect(() => { if (!expanded) return; const close = (event: KeyboardEvent) => event.key === 'Escape' && setExpanded(false); window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [expanded]);
  const syncScreenRatio = () => { const video = videoRef.current; if (kind === 'screen' && video?.videoWidth && video.videoHeight) setScreenRatio(video.videoWidth / video.videoHeight); };
  const fullscreen = () => setExpanded((value) => !value);
  const tile = <article ref={tileRef} className={`mova-call-tile has-video is-${kind} ${expanded ? 'is-expanded' : ''}`} style={kind === 'screen' && screenSize && !expanded ? screenSize : undefined} onDoubleClick={fullscreen}><video ref={videoRef} autoPlay playsInline muted className={mirrored ? 'is-mirrored' : ''} onLoadedMetadata={syncScreenRatio} onResize={syncScreenRatio} />{kind === 'screen' && <button type="button" className="mova-call-fullscreen" aria-label={expanded ? 'Закрыть полноэкранный режим' : 'Открыть демонстрацию на весь экран'} onClick={fullscreen}>{expanded ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>}<CallTileLabel label={label} muted={muted} deafened={deafened} screen={kind === 'screen'} /></article>;
  return expanded ? createPortal(tile, document.body) : tile;
}
function CallAvatarTile({ user, label, muted = false, deafened = false }: { user: AppUser; label: string; muted?: boolean; deafened?: boolean }) { return <article className="mova-call-tile is-avatar"><Avatar name={user.name} src={user.avatarDataUrl} color={user.color} size="xl" initialsLength={1} /><CallTileLabel label={label} muted={muted} deafened={deafened} /></article>; }
function CallTileLabel({ label, muted, deafened, screen }: { label: string; muted?: boolean; deafened?: boolean; screen?: boolean }) { return <span className="mova-call-label">{screen && <MonitorUp size={14} />}{deafened ? <Headphones size={14} aria-label="Выключены наушники" /> : muted ? <MicOff size={14} aria-label="Микрофон выключен" /> : null}{label}</span>; }

export function RealMessages({ conversation, currentUser, messages, onSend }: { conversation: AppConversation; currentUser: AppUser; messages: AppMessage[]; onSend: (content: string, attachment?: MessageAttachment) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachment, setAttachment] = useState<MessageAttachment | undefined>();
  const [attachmentError, setAttachmentError] = useState('');
  const [draggingFile, setDraggingFile] = useState(false);
  const [imagePreview, setImagePreview] = useState<MessageAttachment | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [callChatOpen, setCallChatOpen] = useState(false);
  const [callChatWidth, setCallChatWidth] = useState(() => { const stored = typeof window === 'undefined' ? null : window.localStorage.getItem('mova-call-chat-width'); const saved = stored === null ? NaN : Number(stored); return Number.isFinite(saved) ? Math.min(720, Math.max(320, saved)) : 420; });
  const fileInput = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLElement>(null);
  const messagesContainer = useRef<HTMLDivElement>(null);
  const messageElements = useRef(new Map<string, HTMLElement>());
  const previousMessageCount = useRef(0);
  const positionedAtBottom = useRef(false);
  const dragDepth = useRef(0);
  const other = conversation.members.find((member) => member.id !== currentUser.id);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const matchingMessages = useMemo(() => normalizedSearch ? messages.filter((message) => message.content.toLocaleLowerCase().includes(normalizedSearch) || message.attachment?.name.toLocaleLowerCase().includes(normalizedSearch)).reverse() : [], [messages, normalizedSearch]);
  const activeMatchId = matchingMessages[activeMatchIndex]?.id || matchingMessages[0]?.id;
  const matchCount = matchingMessages.length;
  const status = other?.activity ? `${other.activity.name} · ${activityTime(other.activity.startedAt)}` : conversation.kind === 'direct' ? other?.presence === 'online' ? 'в сети' : 'был(а) недавно' : `${conversation.members.length} участников`;

  const send = async () => {
    const content = value.trim();
    if ((!content && !attachment) || sending) return;
    setSending(true);
    try { await onSend(content, attachment); setValue(''); setAttachment(undefined); setEmojiOpen(false); }
    finally { setSending(false); }
  };
  const chooseFile = async (file?: File) => {
    if (!file) return;
    setAttachmentError('');
    if (file.size > 8_000_000) return setAttachmentError('Файл должен быть меньше 8 МБ');
    try {
      const clipboardName = `Изображение ${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }).replace(':', '-')}.png`;
      setAttachment({ name: file.name || clipboardName, type: file.type || 'application/octet-stream', size: file.size, dataUrl: await readImage(file) });
    } catch { setAttachmentError('Не удалось прочитать файл'); }
  };
  const pasteFile = (event: ClipboardEvent) => {
    const file = Array.from(event.clipboardData.items).find((item) => item.kind === 'file')?.getAsFile() || event.clipboardData.files[0];
    if (!file) return;
    event.preventDefault();
    void chooseFile(file);
  };
  const enterFile = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingFile(true);
  };
  const leaveFile = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDraggingFile(false);
  };
  const dropFile = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingFile(false);
    void chooseFile(event.dataTransfer.files[0]);
  };
  useEffect(() => {
    if (!imagePreview) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setImagePreview(null);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [imagePreview]);
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [normalizedSearch]);
  useEffect(() => {
    if (!callOpen) setCallChatOpen(false);
    else { setSearchOpen(false); setDetailsOpen(false); }
  }, [callOpen]);
  useEffect(() => {
    if (!activeMatchId) return;
    const match = messageElements.current.get(activeMatchId);
    if (match && typeof match.scrollIntoView === 'function') match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeMatchId]);
  useEffect(() => {
    const messageCount = messages.length;
    const ownMessageAdded = messageCount > previousMessageCount.current && messages.at(-1)?.authorId === currentUser.id;
    if (messageCount && (!positionedAtBottom.current || ownMessageAdded)) {
      const container = messagesContainer.current;
      if (container) {
        if (typeof container.scrollTo === 'function') container.scrollTo({ top: container.scrollHeight, behavior: positionedAtBottom.current ? 'smooth' : 'auto' });
        else container.scrollTop = container.scrollHeight;
      }
      positionedAtBottom.current = true;
    }
    previousMessageCount.current = messageCount;
  }, [messages, currentUser.id]);

  const showOlderMatch = () => setActiveMatchIndex((index) => Math.min(matchCount - 1, index + 1));
  const showNewerMatch = () => setActiveMatchIndex((index) => Math.max(0, index - 1));
  const resizeCallChat = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = callChatWidth;
    const maxWidth = Math.max(320, Math.min(720, (threadRef.current?.clientWidth || 1020) - 300));
    document.body.classList.add('mova-is-resizing-call-chat');
    const nextWidth = (clientX: number) => Math.min(maxWidth, Math.max(320, startWidth + startX - clientX));
    const move = (moveEvent: PointerEvent) => setCallChatWidth(nextWidth(moveEvent.clientX));
    const stop = (upEvent: PointerEvent) => {
      const width = nextWidth(upEvent.clientX);
      setCallChatWidth(width);
      window.localStorage.setItem('mova-call-chat-width', String(width));
      document.body.classList.remove('mova-is-resizing-call-chat');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const nudgeCallChat = (amount: number) => setCallChatWidth((width) => { const next = Math.min(720, Math.max(320, width + amount)); window.localStorage.setItem('mova-call-chat-width', String(next)); return next; });

  return <section ref={threadRef} className={`mova-real-thread mova-open-chat ${callOpen ? 'is-in-call' : ''} ${callOpen && callChatOpen ? 'is-call-chat-open' : ''} ${draggingFile ? 'is-file-dragging' : ''}`} style={{ '--mova-call-chat-width': `${callChatWidth}px` } as CSSProperties} onDragEnter={enterFile} onDragOver={(event) => event.preventDefault()} onDragLeave={leaveFile} onDrop={dropFile}>
    {draggingFile && <div className="mova-file-drop-overlay"><Upload size={28} /><strong>Отпустите, чтобы прикрепить</strong><span>Изображение или файл до 8 МБ</span></div>}
    <header className="mova-real-thread__header">
      <ConversationAvatar conversation={conversation} currentUser={currentUser} />
      <span><strong>{conversation.title}</strong><small>{status}</small></span>
      <div>
        <VoiceCallBar conversation={conversation} currentUser={currentUser} chatOpen={callChatOpen} onToggleChat={() => setCallChatOpen((open) => !open)} onCallStateChange={setCallOpen} />
        <IconButton label="Поиск" className={searchOpen ? 'is-active' : ''} onClick={() => { setSearchOpen((open) => !open); setDetailsOpen(false); }}><Search size={18} /></IconButton>
        <IconButton label="Подробнее" className={detailsOpen ? 'is-active' : ''} onClick={() => { setDetailsOpen((open) => !open); setSearchOpen(false); }}><MoreHorizontal size={18} /></IconButton>
      </div>
    </header>
    <div className="mova-call-host" />
    {callOpen && callChatOpen && <div className="mova-call-chat-resizer" role="separator" aria-label="Изменить ширину чата звонка" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={720} aria-valuenow={Math.round(callChatWidth)} tabIndex={0} onPointerDown={resizeCallChat} onDoubleClick={() => { setCallChatWidth(420); window.localStorage.setItem('mova-call-chat-width', '420'); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeCallChat(16); } if (event.key === 'ArrowRight') { event.preventDefault(); nudgeCallChat(-16); } }}><i /></div>}
    {callOpen && callChatOpen && <header className="mova-call-chat-header"><MessageCircle size={20} /><span><strong>{conversation.title}</strong><small>Чат звонка</small></span><IconButton label="Закрыть чат" onClick={() => setCallChatOpen(false)}><X size={19} /></IconButton></header>}
    {searchOpen && <div className="mova-chat-search-panel"><Search size={17} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); if (event.key === 'Enter' && matchCount) { event.preventDefault(); event.shiftKey ? showNewerMatch() : showOlderMatch(); } if (event.key === 'ArrowUp' && matchCount) { event.preventDefault(); showOlderMatch(); } if (event.key === 'ArrowDown' && matchCount) { event.preventDefault(); showNewerMatch(); } }} placeholder="Поиск в переписке" aria-label="Поиск в переписке" /><span aria-live="polite">{normalizedSearch ? matchCount ? `${Math.min(activeMatchIndex + 1, matchCount)} из ${matchCount}` : 'Не найдено' : 'Введите запрос'}</span><IconButton label="К более старому сообщению" disabled={!matchCount || activeMatchIndex >= matchCount - 1} onClick={showOlderMatch}><ChevronUp size={17} /></IconButton><IconButton label="К более новому сообщению" disabled={!matchCount || activeMatchIndex === 0} onClick={showNewerMatch}><ChevronDown size={17} /></IconButton><IconButton label="Закрыть поиск" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}><X size={17} /></IconButton></div>}
    {detailsOpen && <aside className="mova-chat-details"><IconButton label="Закрыть" onClick={() => setDetailsOpen(false)}><X size={17} /></IconButton><ConversationAvatar conversation={conversation} currentUser={currentUser} /><strong>{conversation.title}</strong><small>{status}</small>{other?.handle && <span>{other.handle}</span>}{other?.bio && <p>{other.bio}</p>}{conversation.kind === 'group' && <div><b>Участники</b>{conversation.members.map((member) => <span key={member.id}><Avatar name={member.name} src={member.avatarDataUrl} color={member.color} size="sm" />{member.name}</span>)}</div>}</aside>}
    <div className="mova-real-messages" ref={messagesContainer}>
      <div className="mova-real-thread-intro"><ConversationAvatar conversation={conversation} currentUser={currentUser} /><h1>{conversation.title}</h1><p>{conversation.kind === 'direct' ? `Это начало вашей переписки${other ? ` с ${other.name}` : ''}.` : 'Группа создана. Можно начинать разговор.'}</p></div>
      {messages.map((message, index) => {
        const own = message.authorId === currentUser.id;
        const previous = messages[index - 1];
        const grouped = previous?.authorId === message.authorId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 300000;
        const matches = Boolean(normalizedSearch && (message.content.toLocaleLowerCase().includes(normalizedSearch) || message.attachment?.name.toLocaleLowerCase().includes(normalizedSearch)));
        return <article ref={(element) => { if (element) messageElements.current.set(message.id, element); else messageElements.current.delete(message.id); }} className={`mova-real-message ${own ? 'is-own' : ''} ${grouped ? 'is-grouped' : ''} ${matches ? 'is-search-match' : ''} ${message.id === activeMatchId ? 'is-active-search-match' : ''}`} key={message.id}>
          {!own && !grouped && <Avatar name={message.author.name} src={message.author.avatarDataUrl} color={message.author.color} size="sm" />}
          <div>{conversation.kind === 'group' && !own && !grouped && <strong>{message.author.name}</strong>}<div className="mova-real-bubble">
            {message.attachment && (message.attachment.type.startsWith('image/') ? <button type="button" className="mova-message-image" onClick={() => setImagePreview(message.attachment || null)} aria-label={`Открыть изображение ${message.attachment.name}`}><img src={message.attachment.dataUrl} alt={message.attachment.name} /></button> : <a className="mova-message-file" href={message.attachment.dataUrl} download={message.attachment.name}><FileText size={20} /><span><strong>{message.attachment.name}</strong><small>{Math.max(1, Math.round(message.attachment.size / 1024))} КБ</small></span></a>)}
            {message.content && <p>{message.content}</p>}
            <time>{new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))}</time>{own && <MessageStatus message={message} conversation={conversation} />}
          </div></div>
        </article>;
      })}
    </div>
    <form className="mova-real-composer" onPaste={pasteFile} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {attachment && <div className="mova-attachment-draft">{attachment.type.startsWith('image/') ? <img src={attachment.dataUrl} alt="" /> : <FileText size={16} />}<span>{attachment.name}</span><button type="button" aria-label="Убрать вложение" onClick={() => setAttachment(undefined)}><X size={14} /></button></div>}
      <input ref={fileInput} type="file" hidden onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
      <IconButton label="Прикрепить файл" onClick={() => fileInput.current?.click()}><Paperclip size={19} /></IconButton>
      <textarea rows={1} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} aria-label={`Сообщение в ${conversation.title}`} placeholder="Напишите сообщение…" />
      {emojiOpen && <div className="mova-emoji-picker">{['😀','😂','🥰','😎','🤔','👍','🔥','❤️','🎉','✨','👀','🙏'].map((emoji) => <button type="button" key={emoji} onClick={() => { setValue((text) => text + emoji); setEmojiOpen(false); }}>{emoji}</button>)}</div>}
      <IconButton label="Эмодзи" className={emojiOpen ? 'is-active' : ''} onClick={() => setEmojiOpen((open) => !open)}><Smile size={19} /></IconButton>
      <button type="submit" aria-label="Отправить" disabled={(!value.trim() && !attachment) || sending}><Send size={18} /></button>
      {attachmentError && <span className="mova-attachment-error">{attachmentError}</span>}
    </form>
    {imagePreview && createPortal(<div className="mova-image-viewer" role="dialog" aria-modal="true" aria-label={`Просмотр изображения ${imagePreview.name}`} onMouseDown={(event) => event.target === event.currentTarget && setImagePreview(null)}>
      <div className="mova-image-viewer__toolbar"><span>{imagePreview.name}</span><a href={imagePreview.dataUrl} download={imagePreview.name} aria-label="Скачать изображение"><Download size={19} /></a><button type="button" aria-label="Закрыть изображение" onClick={() => setImagePreview(null)}><X size={21} /></button></div>
      <img src={imagePreview.dataUrl} alt={imagePreview.name} />
    </div>, document.body)}
  </section>;
}

function Product({ currentUser, onUserUpdate, onLogout }: { currentUser: AppUser; onUserUpdate: (user: AppUser) => void; onLogout: () => void }) {
  const [conversations, setConversations] = useState<AppConversation[]>([]); const [users, setUsers] = useState<AppUser[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null); const [messages, setMessages] = useState<AppMessage[]>([]); const [loading, setLoading] = useState(true); const [createOpen, setCreateOpen] = useState(false); const [profileOpen, setProfileOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [accountOpen, setAccountOpen] = useState(false); const [query, setQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() => { const stored = typeof window === 'undefined' ? null : window.localStorage.getItem('mova-sidebar-width'); const saved = stored === null ? NaN : Number(stored); return Number.isFinite(saved) ? Math.min(560, Math.max(260, saved)) : 360; });
  const currentUserRef = useRef(currentUser); const lastActivity = useRef(Date.now()); const markingReadThrough = useRef<string | null>(null); currentUserRef.current = currentUser;
  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add('mova-is-resizing-sidebar');
    const move = (moveEvent: PointerEvent) => setSidebarWidth(Math.min(560, Math.max(260, startWidth + moveEvent.clientX - startX)));
    const stop = (upEvent: PointerEvent) => {
      const width = Math.min(560, Math.max(260, startWidth + upEvent.clientX - startX));
      setSidebarWidth(width);
      window.localStorage.setItem('mova-sidebar-width', String(width));
      document.body.classList.remove('mova-is-resizing-sidebar');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const nudgeSidebar = (amount: number) => setSidebarWidth((width) => { const next = Math.min(560, Math.max(260, width + amount)); window.localStorage.setItem('mova-sidebar-width', String(next)); return next; });
  useEffect(() => { const openSettings = () => setSettingsOpen(true); window.addEventListener('mova-open-settings', openSettings); return () => window.removeEventListener('mova-open-settings', openSettings); }, []);
  useEffect(() => realtime.subscribe((event) => { if (event.type === 'message:new' && event.message.authorId !== currentUserRef.current.id && currentUserRef.current.presence !== 'dnd') { const audio = new Audio(messageSoundUrl); audio.volume = .5; void audio.play().catch(() => undefined); } }), []);
  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;
  const reloadConversations = useCallback(async () => { const result = await api.conversations(); setConversations(result.conversations); setSelectedId((current) => current && result.conversations.some((item) => item.id === current) ? current : result.conversations[0]?.id || null); }, []);
  useEffect(() => { Promise.all([reloadConversations(), api.users().then((result) => setUsers(result.users))]).finally(() => setLoading(false)); realtime.connect(); const unsubscribe = realtime.subscribe((event: RealtimeEvent) => { if (event.type === 'message:new') { setMessages((items) => event.message.conversationId === selectedId && !items.some((item) => item.id === event.message.id) ? [...items, event.message] : items); void reloadConversations(); } if (event.type === 'message:read' && event.conversationId === selectedId) { const readIds = new Set(event.messageIds); setMessages((items) => items.map((message) => readIds.has(message.id) && !message.readBy?.some((receipt) => receipt.userId === event.userId) ? { ...message, readBy: [...(message.readBy || []), { userId: event.userId, readAt: event.readAt }] } : message)); } if (event.type === 'conversation:new') void reloadConversations(); if (event.type === 'profile:update' || event.type === 'presence:update') { setUsers((items) => items.map((user) => user.id === event.user.id ? event.user : user)); setConversations((items) => items.map((conversation) => ({ ...conversation, members: conversation.members.map((member) => member.id === event.user.id ? event.user : member), title: conversation.kind === 'direct' && event.user.id !== currentUser.id ? event.user.name : conversation.title }))); } }); return () => { unsubscribe(); realtime.close(); }; }, [reloadConversations, selectedId, currentUser.id]);
  useEffect(() => { const markActive = () => { lastActivity.current = Date.now(); if (currentUserRef.current.presence === 'idle') void api.updatePresence('online').then((result) => onUserUpdate(result.user)); }; const events = ['pointerdown', 'keydown', 'mousemove']; events.forEach((event) => window.addEventListener(event, markActive, { passive: true })); const timer = window.setInterval(() => { if (currentUserRef.current.presence === 'online' && Date.now() - lastActivity.current >= 15 * 60_000) void api.updatePresence('idle').then((result) => onUserUpdate(result.user)); }, 30_000); return () => { events.forEach((event) => window.removeEventListener(event, markActive)); window.clearInterval(timer); }; }, [onUserUpdate]);
  useEffect(() => { if (currentUser.presence !== 'dnd' || !currentUser.dndUntil || currentUser.dndUntil === 'forever') return; const remaining = new Date(currentUser.dndUntil).getTime() - Date.now(); if (remaining <= 0) { void api.updatePresence('online').then((result) => onUserUpdate(result.user)); return; } const timer = window.setTimeout(() => void api.updatePresence('online').then((result) => onUserUpdate(result.user)), remaining); return () => window.clearTimeout(timer); }, [currentUser.presence, currentUser.dndUntil, onUserUpdate]);
  useEffect(() => { if (!selectedId) return setMessages([]); api.messages(selectedId).then((result) => setMessages(result.messages)); }, [selectedId]);
  useEffect(() => {
    const markRead = () => {
      if (!selectedId || document.visibilityState !== 'visible') return;
      const latestUnread = [...messages].reverse().find((message) => message.conversationId === selectedId && message.authorId !== currentUser.id && !message.readBy?.some((receipt) => receipt.userId === currentUser.id));
      if (!latestUnread || markingReadThrough.current === latestUnread.id) return;
      markingReadThrough.current = latestUnread.id;
      void api.markConversationRead(selectedId, latestUnread.id).then((result) => {
        const readIds = new Set(result.messageIds);
        setMessages((items) => items.map((message) => readIds.has(message.id) && !message.readBy?.some((receipt) => receipt.userId === result.userId) ? { ...message, readBy: [...(message.readBy || []), { userId: result.userId, readAt: result.readAt }] } : message));
      }).finally(() => { if (markingReadThrough.current === latestUnread.id) markingReadThrough.current = null; });
    };
    markRead();
    document.addEventListener('visibilitychange', markRead); window.addEventListener('focus', markRead);
    return () => { document.removeEventListener('visibilitychange', markRead); window.removeEventListener('focus', markRead); };
  }, [selectedId, messages, currentUser.id]);
  const send = async (content: string, attachment?: MessageAttachment) => { if (!selectedId) return; const result = await api.sendMessage(selectedId, content, attachment); setMessages((items) => items.some((item) => item.id === result.message.id) ? items : [...items, result.message]); void reloadConversations(); };
  const visible = useMemo(() => conversations.filter((conversation) => conversation.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [conversations, query]);
  return <main className="mova-real-app mova-tg-app" style={{ '--mova-sidebar-width': `${sidebarWidth}px` } as CSSProperties}><div className="mova-real-aurora" /><aside className="mova-real-sidebar mova-tg-sidebar"><div className="mova-tg-search-row"><div className="mova-account-anchor"><IconButton label="Меню и профиль" className="mova-tg-menu" onClick={() => setAccountOpen(!accountOpen)}><Menu size={23} /></IconButton><AccountMenu user={currentUser} open={accountOpen} onClose={() => setAccountOpen(false)} onEdit={() => setProfileOpen(true)} onSettings={() => setSettingsOpen(true)} onUpdated={onUserUpdate} onLogout={onLogout} /></div><label className="mova-tg-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" aria-label="Поиск по чатам" /></label></div><div className="mova-real-chat-list">{loading ? <div className="mova-real-loading">Загружаем разговоры…</div> : visible.length === 0 ? <div className="mova-real-empty-list"><MessageCircle size={25} /><strong>{conversations.length ? 'Ничего не найдено' : 'Пока тихо'}</strong><p>{conversations.length ? 'Попробуйте другой запрос' : 'Создайте личный чат или группу'}</p></div> : visible.map((conversation) => <button type="button" key={conversation.id} className={selectedId === conversation.id ? 'is-active' : ''} onClick={() => setSelectedId(conversation.id)}><ConversationAvatar conversation={conversation} currentUser={currentUser} /><span><span><strong>{conversation.title}</strong><time>{conversation.lastMessage ? new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date(conversation.lastMessage.createdAt)) : ''}</time></span><small>{conversation.lastMessage?.content || (conversation.kind === 'group' ? `${conversation.members.length} участников` : 'Начните разговор')}</small></span></button>)}</div><button type="button" className="mova-tg-compose" aria-label="Новый разговор" onClick={() => setCreateOpen(true)}><Pencil size={23} /></button><div className="mova-sidebar-resizer" role="separator" aria-label="Изменить ширину списка чатов" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={560} aria-valuenow={Math.round(sidebarWidth)} tabIndex={0} onPointerDown={startSidebarResize} onDoubleClick={() => { setSidebarWidth(360); window.localStorage.setItem('mova-sidebar-width', '360'); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeSidebar(-16); } if (event.key === 'ArrowRight') { event.preventDefault(); nudgeSidebar(16); } }}><i /></div></aside>{selected ? <RealMessages key={selected.id} conversation={selected} currentUser={currentUser} messages={messages} onSend={send} /> : <section className="mova-real-welcome"><div><span><MessageCircle size={26} /></span><h1>Mova</h1><p>Выберите разговор или создайте новый</p><Button leadingIcon={<Plus size={17} />} onClick={() => setCreateOpen(true)}>Новый разговор</Button></div></section>}<CreateConversation open={createOpen} users={users} onClose={() => setCreateOpen(false)} onCreated={(conversation) => { setConversations((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]); setSelectedId(conversation.id); }} /><SettingsModal user={currentUser} open={settingsOpen} onClose={() => setSettingsOpen(false)} onEditProfile={() => setProfileOpen(true)} /><ProfileEditor user={currentUser} open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={onUserUpdate} /></main>;
}

export function RealApp() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null); const [checking, setChecking] = useState(Boolean(session.get()));
  useEffect(() => { if (!session.get()) return; api.me().then((result) => setCurrentUser(result.user)).catch(() => session.clear()).finally(() => setChecking(false)); }, []);
  if (checking) return <div className="mova-boot"><span>M</span><p>Открываем Mova…</p></div>;
  if (!currentUser) return <AuthScreen onAuth={(user) => { setCurrentUser(user); setChecking(false); }} />;
  return <Product currentUser={currentUser} onUserUpdate={setCurrentUser} onLogout={() => { realtime.close(); session.clear(); setCurrentUser(null); }} />;
}
