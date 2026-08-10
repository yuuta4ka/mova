import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bell,
  BellOff,
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Compass,
  Download,
  FileText,
  Gift,
  Hash,
  Headphones,
  LogOut,
  Menu,
  MessageCircle,
  MessagesSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  PhoneOff,
  Pin,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Smile,
  UserPlus,
  Users,
  Volume2,
} from 'lucide-react';
import type { Channel, Message, Reaction, Space, User, VoiceState } from '../types';
import { Avatar, Badge, Button, Divider, IconButton, Tooltip } from './Primitives';

export function SpaceRail({ spaces }: { spaces: Space[] }) {
  return (
    <nav className="mova-space-rail" aria-label="Пространства">
      <div className="mova-wordmark"><img src="/mova-logo.png" alt="Mova" /></div>
      <div className="mova-space-rail__items">
        {spaces.map((space) => (
          <Tooltip key={space.id} label={space.name} side="right">
            <button type="button" className={`mova-space ${space.active ? 'is-active' : ''}`} aria-label={space.name} aria-current={space.active ? 'page' : undefined} style={{ '--space-color': space.color } as React.CSSProperties}>
              <span>{space.initials}</span>
              {space.unread !== undefined && <Badge tone="danger">{space.unread}</Badge>}
            </button>
          </Tooltip>
        ))}
        <button className="mova-space mova-space--add" type="button" aria-label="Добавить пространство"><CirclePlus size={23} /></button>
      </div>
    </nav>
  );
}

function ChannelRow({ channel }: { channel: Channel }) {
  const Icon = channel.kind === 'text' ? Hash : Volume2;
  return (
    <div>
      <button type="button" className={`mova-channel ${channel.active ? 'is-active' : ''} ${channel.unread ? 'is-unread' : ''} ${channel.muted ? 'is-muted' : ''}`}>
        <Icon size={18} aria-hidden /><span>{channel.name}</span>
        {channel.muted && <BellOff size={14} aria-label="Без уведомлений" />}
        {channel.mentions !== undefined && <Badge tone="danger">{channel.mentions}</Badge>}
      </button>
      {channel.kind === 'voice' && channel.participants?.map((user) => (
        <button type="button" className="mova-voice-user" key={user.id}><Avatar name={user.name} color={user.color} size="xs" speaking={user.id === 'u2'} /><span>{user.name}</span></button>
      ))}
    </div>
  );
}

export function ChannelSidebar({ channels, currentUser, voice }: { channels: Channel[]; currentUser: User; voice: VoiceState }) {
  const categories = useMemo(() => [...new Set(channels.map((channel) => channel.category))], [channels]);
  return (
    <aside className="mova-channel-sidebar">
      <button type="button" className="mova-space-title"><span>Северный клуб</span><ChevronDown size={18} /></button>
      <div className="mova-channel-scroll">
        <button type="button" className="mova-event-card"><span className="mova-event-card__icon">✨</span><span><strong>Встреча клуба</strong><small>Сегодня в 20:00</small></span><ChevronRight size={16} /></button>
        {categories.map((category) => <section className="mova-channel-group" key={category} aria-label={category}>
          <header><button type="button"><ChevronDown size={13} />{category}</button><IconButton label="Добавить канал" size="sm"><CirclePlus size={15} /></IconButton></header>
          {channels.filter((channel) => channel.category === category).map((channel) => <ChannelRow key={channel.id} channel={channel} />)}
        </section>)}
      </div>
      <VoicePanel state={voice} />
      <div className="mova-self-panel"><Avatar name={currentUser.name} color={currentUser.color} status={currentUser.presence} size="sm" /><span><strong>{currentUser.name}</strong><small>{currentUser.handle}</small></span><Tooltip label="Микрофон"><IconButton label="Микрофон" size="sm"><Mic size={17} /></IconButton></Tooltip><Tooltip label="Настройки"><IconButton label="Настройки" size="sm"><Settings size={17} /></IconButton></Tooltip></div>
    </aside>
  );
}

export function ChannelHeader({ name, topic }: { name: string; topic: string }) {
  return (
    <header className="mova-channel-header"><div className="mova-channel-header__title"><Hash size={22} /><strong>{name}</strong><span>{topic}</span></div><div className="mova-channel-header__actions"><Tooltip label="Уведомления"><IconButton label="Уведомления"><Bell size={19} /></IconButton></Tooltip><Tooltip label="Закреплённые"><IconButton label="Закреплённые сообщения"><Pin size={19} /></IconButton></Tooltip><Tooltip label="Участники"><IconButton label="Показать участников"><Users size={19} /></IconButton></Tooltip><label className="mova-header-search"><Search size={16} /><input placeholder="Поиск" aria-label="Поиск сообщений" /></label><IconButton label="Меню"><Menu size={19} /></IconButton></div></header>
  );
}

export function ReactionButton({ reaction, onToggle }: { reaction: Reaction; onToggle?: () => void }) {
  return <button type="button" className={`mova-reaction ${reaction.reacted ? 'is-reacted' : ''}`} aria-label={`${reaction.emoji} ${reaction.count}`} aria-pressed={reaction.reacted ?? false} onClick={onToggle}><span aria-hidden>{reaction.emoji}</span><span aria-hidden>{reaction.count}</span></button>;
}

export function MessageItem({ message }: { message: Message }) {
  const [reactions, setReactions] = useState(message.reactions ?? []);
  const toggle = (index: number) => setReactions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, reacted: !item.reacted, count: Math.max(0, item.count + (item.reacted ? -1 : 1)) } : item));
  return (
    <article className={`mova-message ${message.grouped ? 'is-grouped' : ''}`}>
      {!message.grouped && <Avatar name={message.author.name} color={message.author.color} status={message.author.presence} size="md" />}
      {message.grouped && <time className="mova-message__mini-time">{message.time}</time>}
      <div className="mova-message__body">
        {!message.grouped && <header><strong>{message.author.name}</strong>{message.author.role === 'Создатель' && <Badge tone="mint">создатель</Badge>}<time>{message.time}</time>{message.edited && <small>(изменено)</small>}</header>}
        <p>{message.content}</p>
        {message.attachment && <button type="button" className="mova-attachment"><FileText size={25} /><span><strong>{message.attachment.name}</strong><small>{message.attachment.size}</small></span><Download size={18} /></button>}
        {reactions.length > 0 && <div className="mova-reactions">{reactions.map((reaction, index) => <ReactionButton key={`${reaction.emoji}-${index}`} reaction={reaction} onToggle={() => toggle(index)} />)}<button type="button" aria-label="Добавить реакцию"><Smile size={15} /></button></div>}
      </div>
      <div className="mova-message__actions"><IconButton label="Добавить реакцию" size="sm"><Smile size={16} /></IconButton><IconButton label="Ответить" size="sm"><MessageCircle size={16} /></IconButton><IconButton label="Ещё" size="sm"><MoreHorizontal size={16} /></IconButton></div>
    </article>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="mova-message-list">
      <div className="mova-channel-intro"><span><Hash size={28} /></span><h1>Добро пожаловать в #общий</h1><p>Здесь начинаются разговоры Северного клуба. Будьте собой и чувствуйте себя как дома.</p></div>
      <Divider label="6 октября 2026" />
      {messages.map((message) => <MessageItem key={message.id} message={message} />)}
    </div>
  );
}

export function MessageComposer({ channel }: { channel: string }) {
  const [value, setValue] = useState('');
  return (
    <div className="mova-composer-wrap"><div className="mova-typing"><span><i /><i /><i /></span>Лера печатает…</div><form className="mova-composer" onSubmit={(event) => { event.preventDefault(); setValue(''); }}><IconButton label="Добавить файл"><CirclePlus size={21} /></IconButton><textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder={`Написать в #${channel}`} aria-label={`Сообщение в канал ${channel}`} rows={1} /><div className="mova-composer__actions"><IconButton label="Прикрепить файл"><Paperclip size={19} /></IconButton><IconButton label="Подарок"><Gift size={19} /></IconButton><IconButton label="Эмодзи"><Smile size={19} /></IconButton>{value && <IconButton label="Отправить" className="mova-composer__send" type="submit"><Send size={18} /></IconButton>}</div></form></div>
  );
}

export function MemberList({ users }: { users: User[] }) {
  const online = users.filter((user) => user.presence !== 'offline');
  const offline = users.filter((user) => user.presence === 'offline');
  const group = (title: string, people: User[]) => <section className="mova-member-group"><h2>{title} — {people.length}</h2>{people.map((user) => <button type="button" className={`mova-member ${user.presence === 'offline' ? 'is-offline' : ''}`} key={user.id}><Avatar name={user.name} color={user.color} status={user.presence} size="sm" /><span><strong>{user.name}</strong><small>{user.activity ?? user.role}</small></span>{user.role === 'Модератор' && <span className="mova-member__role" title="Модератор">✦</span>}</button>)}</section>;
  return <aside className="mova-member-list"><Button variant="secondary" size="sm" leadingIcon={<UserPlus size={16} />}>Пригласить</Button>{group('В СЕТИ', online)}{group('НЕ В СЕТИ', offline)}</aside>;
}

export function ProfileCard({ user }: { user: User }) {
  return <section className="mova-profile-card"><div className="mova-profile-card__cover" /><Avatar name={user.name} color={user.color} status={user.presence} size="xl" /><div className="mova-profile-card__body"><h2>{user.name}</h2><span>{user.handle}</span><Divider /><h3>Обо мне</h3><p>Люблю тёплые разговоры, музыку и большие идеи.</p><Button variant="secondary" size="sm">Написать сообщение</Button></div></section>;
}

export function VoicePanel({ state }: { state: VoiceState }) {
  return <section className="mova-voice-panel"><div className="mova-voice-panel__status"><span className="mova-voice-bars"><i /><i /><i /></span><span><strong>Голос подключён</strong><small>{state.channelName} · Отличное соединение</small></span></div><div className="mova-voice-panel__actions"><Tooltip label={state.muted ? 'Включить микрофон' : 'Выключить микрофон'}><IconButton label="Микрофон">{state.muted ? <MicOff size={18} /> : <Mic size={18} />}</IconButton></Tooltip><Tooltip label="Наушники"><IconButton label="Наушники"><Headphones size={18} /></IconButton></Tooltip><Tooltip label="Отключиться"><IconButton label="Отключиться" className="is-danger"><PhoneOff size={18} /></IconButton></Tooltip></div></section>;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="mova-empty">{icon}<h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function MovaTopbar({ currentUser, section, onSectionChange }: { currentUser: User; section: 'chats' | 'spaces'; onSectionChange: (section: 'chats' | 'spaces') => void }) {
  return <header className="mova-topbar">
    <button type="button" className="mova-topbar__brand" aria-label="Главная Mova"><img src="/mova-logo.png" alt="" /><strong>Mova</strong></button>
    <nav className="mova-mode-switch" aria-label="Разделы приложения">
      <button type="button" className={section === 'chats' ? 'is-active' : ''} aria-current={section === 'chats' ? 'page' : undefined} onClick={() => onSectionChange('chats')}><MessagesSquare size={17} />Чаты</button>
      <button type="button" className={section === 'spaces' ? 'is-active' : ''} aria-current={section === 'spaces' ? 'page' : undefined} onClick={() => onSectionChange('spaces')}><Compass size={17} />Пространства</button>
    </nav>
    <label className="mova-command-search"><Search size={17} /><input aria-label="Поиск в Mova" placeholder="Найти людей, чаты и сообщения" /><kbd>⌘ K</kbd></label>
    <div className="mova-topbar__actions"><IconButton label="Уведомления"><Bell size={19} /></IconButton><button type="button" className="mova-account"><Avatar name={currentUser.name} color={currentUser.color} status={currentUser.presence} size="sm" /><span><strong>{currentUser.name}</strong><small>в сети</small></span><ChevronDown size={15} /></button></div>
  </header>;
}

export function SpaceNavigator({ spaces, channels }: { spaces: Space[]; channels: Channel[] }) {
  const categories = useMemo(() => [...new Set(channels.map((channel) => channel.category))], [channels]);
  return <aside className="mova-space-nav">
    <div className="mova-space-picker">
      <div className="mova-space-picker__art">СК</div>
      <span><small>ТЕКУЩЕЕ ПРОСТРАНСТВО</small><strong>Северный клуб</strong><em>248 участников</em></span>
      <ChevronDown size={18} />
    </div>
    <div className="mova-nav-divider"><span>КАНАЛЫ</span><IconButton label="Добавить канал" size="sm"><CirclePlus size={16} /></IconButton></div>
    <div className="mova-space-nav__channels">
      {categories.map((category) => <section key={category} className="mova-nav-category"><button type="button" className="mova-nav-category__title"><ChevronDown size={13} />{category.toLocaleLowerCase()}</button>{channels.filter((channel) => channel.category === category).map((channel) => <button type="button" key={channel.id} className={`mova-nav-channel ${channel.active ? 'is-active' : ''}`}><span className="mova-nav-channel__icon">{channel.kind === 'text' ? <Hash size={17} /> : <Volume2 size={17} />}</span><span>{channel.name}</span>{channel.participants?.length ? <div className="mova-channel-faces">{channel.participants.slice(0, 2).map((user) => <Avatar key={user.id} name={user.name} color={user.color} size="xs" />)}</div> : null}{channel.mentions ? <Badge tone="danger">{channel.mentions}</Badge> : null}</button>)}</section>)}
    </div>
    <button type="button" className="mova-nav-invite"><UserPlus size={17} /><span><strong>Позвать своих</strong><small>Ссылка-приглашение</small></span><ChevronRight size={16} /></button>
  </aside>;
}

function ConversationMessage({ message, own, direct }: { message: Message; own?: boolean; direct?: boolean }) {
  const [reactions, setReactions] = useState(message.reactions ?? []);
  return <article className={`mova-conversation-message ${own ? 'is-own' : ''} ${message.grouped ? 'is-grouped' : ''} ${direct ? 'is-direct' : ''}`}>
    {!message.grouped && !own && <Avatar name={message.author.name} color={message.author.color} status={message.author.presence} size="md" />}
    <div className="mova-conversation-message__wrap">
      {!message.grouped && !direct && <header><strong>{own ? 'Вы' : message.author.name}</strong><time>{message.time}</time></header>}
      <div className="mova-conversation-bubble"><p>{message.content}</p>{direct && <time className="mova-bubble-time">{message.time}</time>}{reactions.length > 0 && <div className="mova-bubble-reactions">{reactions.map((reaction, index) => <button type="button" key={`${reaction.emoji}-${index}`} className={reaction.reacted ? 'is-active' : ''} aria-label={`${reaction.emoji} ${reaction.count}`} onClick={() => setReactions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, reacted: !item.reacted, count: item.count + (item.reacted ? -1 : 1) } : item))}>{reaction.emoji}<span>{reaction.count}</span></button>)}</div>}</div>
    </div>
  </article>;
}

export function ConversationView({ messages, users }: { messages: Message[]; users: User[] }) {
  const [value, setValue] = useState('');
  return <section className="mova-conversation">
    <header className="mova-conversation-header"><div><span className="mova-conversation-header__symbol"><Hash size={20} /></span><span><strong>Общий</strong><small>Разговоры без повестки и уютная компания</small></span></div><div className="mova-conversation-header__actions"><IconButton label="Найти в разговоре"><Search size={19} /></IconButton><IconButton label="Участники"><Users size={19} /></IconButton><IconButton label="Подробнее"><MoreHorizontal size={19} /></IconButton></div></header>
    <div className="mova-conversation__scroll"><div className="mova-conversation-intro"><span>6 ОКТЯБРЯ</span><h1>Вечер начинается здесь</h1><p>Никаких формальностей — просто делитесь тем, что хочется обсудить.</p></div>{messages.map((message) => <ConversationMessage key={message.id} message={message} own={message.author.id === 'u0'} />)}</div>
    <form className="mova-new-composer" onSubmit={(event) => { event.preventDefault(); setValue(''); }}><IconButton label="Добавить"><Plus size={20} /></IconButton><textarea aria-label="Сообщение в Общий" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Сообщение в Общий" rows={1} /><div><IconButton label="Эмодзи"><Smile size={19} /></IconButton><button type="submit" aria-label="Отправить" disabled={!value}><Send size={18} /></button></div></form>
  </section>;
}

export function SpaceContext({ users }: { users: User[] }) {
  return <aside className="mova-context-panel">
    <section className="mova-live-room"><div className="mova-live-room__glow" /><header><span><i />ГОЛОСОВАЯ КОМНАТА</span><MoreHorizontal size={18} /></header><h2>У костра</h2><p>Спокойный разговор перед сном</p><div className="mova-live-people">{users.slice(0,3).map((user, index) => <div key={user.id}><Avatar name={user.name} color={user.color} size="lg" speaking={index === 1} /><span>{user.name.split(' ')[0]}</span></div>)}</div><Button leadingIcon={<Headphones size={17} />}>Присоединиться</Button></section>
    <section className="mova-upcoming"><header><h2>Ближайшее</h2><button type="button">Все события</button></header><div className="mova-date-card"><time><strong>09</strong><span>ОКТ</span></time><span><strong>Осенняя встреча</strong><small>Пятница · 20:00</small></span><div className="mova-mini-faces">{users.slice(1,4).map((user) => <Avatar key={user.id} name={user.name} color={user.color} size="xs" />)}</div></div></section>
    <section className="mova-online-now"><header><h2>Сейчас здесь</h2><Badge tone="mint">{users.filter((user) => user.presence !== 'offline').length}</Badge></header>{users.filter((user) => user.presence !== 'offline').slice(0,4).map((user) => <button type="button" key={user.id}><Avatar name={user.name} color={user.color} status={user.presence} size="sm" /><span><strong>{user.name}</strong><small>{user.activity ?? user.role}</small></span></button>)}</section>
  </aside>;
}

const directPreviews: Record<string, { message: string; time: string; unread?: number; pinned?: boolean }> = {
  u1: { message: 'Тогда созвонимся после восьми ✨', time: '18:57', unread: 2, pinned: true },
  u2: { message: 'Отправил тебе подборку мест', time: '18:44' },
  u3: { message: 'Спасибо, посмотрю вечером', time: '17:20', unread: 1 },
  u4: { message: 'Фото получилось отличное', time: 'Пн' },
  u5: { message: 'До встречи на выходных!', time: 'Вс' },
};

export function ChatNavigator({ users, selectedId, onSelect }: { users: User[]; selectedId: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const visibleUsers = users.filter((user) => user.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <aside className="mova-chat-nav">
    <div className="mova-chat-nav__heading"><span><strong>Сообщения</strong><small>Ваши личные разговоры</small></span><IconButton label="Новый чат"><Plus size={19} /></IconButton></div>
    <label className="mova-chat-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по чатам" aria-label="Поиск по чатам" /></label>
    <div className="mova-chat-filters"><button type="button" className="is-active">Все</button><button type="button">Непрочитанные</button><button type="button">Группы</button></div>
    <div className="mova-chat-list">
      {visibleUsers.map((user) => { const preview = directPreviews[user.id] ?? { message: 'Начните новый разговор', time: '' }; return <button type="button" key={user.id} className={`mova-chat-row ${selectedId === user.id ? 'is-active' : ''}`} onClick={() => onSelect(user.id)}><Avatar name={user.name} color={user.color} status={user.presence} size="lg" /><span className="mova-chat-row__content"><span><strong>{user.name}</strong><time>{preview.time}</time></span><span><small>{preview.message}</small>{preview.unread ? <Badge tone="mint">{preview.unread}</Badge> : preview.pinned ? <Pin size={12} /> : null}</span></span></button>; })}
      {visibleUsers.length === 0 && <div className="mova-chat-search-empty">Ничего не найдено</div>}
    </div>
    <button type="button" className="mova-saved-chat"><span><Bookmark size={18} /></span><span><strong>Сохранённое</strong><small>Заметки и важные сообщения</small></span><ChevronRight size={16} /></button>
  </aside>;
}

function createDirectMessages(user: User): Message[] {
  return [
    { id: `d-${user.id}-1`, author: user, time: 'Сегодня, 18:32', content: 'Привет! Как проходит день?', reactions: [{ emoji: '👋', count: 1 }] },
    { id: `d-${user.id}-2`, author: { id: 'u0', name: 'Юта', handle: '@yuuta', presence: 'online', color: '#5DE2D3' }, time: '18:35', content: 'Привет! Хорошо, только закончил дела. Как ты?' },
    { id: `d-${user.id}-3`, author: user, time: '18:41', content: directPreviews[user.id]?.message ?? 'Всё отлично! Хотел немного поболтать.' },
  ];
}

export function DirectConversationView({ user }: { user: User }) {
  const [value, setValue] = useState('');
  const [directMessages, setDirectMessages] = useState(() => createDirectMessages(user));
  useEffect(() => setDirectMessages(createDirectMessages(user)), [user]);
  const send = () => { const content = value.trim(); if (!content) return; setDirectMessages((items) => [...items, { id: `local-${Date.now()}`, author: { id: 'u0', name: 'Юта', handle: '@yuuta', presence: 'online', color: '#5DE2D3' }, time: new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' }).format(new Date()), content }]); setValue(''); };
  return <section className="mova-direct-conversation">
    <header className="mova-direct-header"><Avatar name={user.name} color={user.color} status={user.presence} size="md" /><span className="mova-direct-header__identity"><strong>{user.name}</strong><small>{user.presence === 'online' ? 'в сети' : user.activity ?? 'был(а) недавно'}</small></span><div><IconButton label="Позвонить"><PhoneOff className="mova-phone-icon" size={18} /></IconButton><IconButton label="Поиск"><Search size={19} /></IconButton><IconButton label="Информация"><MoreHorizontal size={19} /></IconButton></div></header>
    <div className="mova-direct-scroll"><div className="mova-direct-profile"><Avatar name={user.name} color={user.color} status={user.presence} size="xl" /><h1>{user.name}</h1><span>{user.handle}</span><p>Это начало вашей личной переписки в Mova.</p></div>{directMessages.map((message) => <ConversationMessage key={message.id} message={message} own={message.author.id === 'u0'} direct />)}</div>
    <form className="mova-new-composer mova-direct-composer" onSubmit={(event) => { event.preventDefault(); send(); }}><IconButton label="Добавить"><Plus size={20} /></IconButton><textarea aria-label={`Сообщение для ${user.name}`} value={value} onChange={(event) => setValue(event.target.value)} placeholder={`Сообщение для ${user.name}`} rows={1} /><div><IconButton label="Эмодзи"><Smile size={19} /></IconButton><button type="submit" aria-label="Отправить" disabled={!value.trim()}><Send size={18} /></button></div></form>
  </section>;
}
