import { useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Code2,
  Download,
  Globe2,
  Heart,
  Laptop,
  MessageCircleMore,
  MonitorDown,
  Play,
  Radio,
  ScreenShare,
  Video,
  X,
} from 'lucide-react';
import desktopRelease from '../desktop/release.json';

const version = desktopRelease.version;
const releaseTag = desktopRelease.tag;
const githubUrl = `https://github.com/${desktopRelease.repository}`;
const donationUrl = 'https://donatex.gg/donate/yuuta';
const releaseBase = `${githubUrl}/releases/download/v${releaseTag}`;

export type DesktopPlatform = 'windows' | 'macos' | 'other';

const downloads = [
  {
    platform: 'windows' as const,
    name: 'Windows',
    detail: 'Windows 10 и 11 · x64',
    format: 'EXE',
    href: `${releaseBase}/Mova.Setup.${version}.exe`,
    icon: MonitorDown,
  },
  {
    platform: 'macos' as const,
    name: 'macOS',
    detail: 'Mac с Apple Silicon',
    format: 'DMG',
    href: `${releaseBase}/Mova-${version}-arm64.dmg`,
    icon: Laptop,
  },
];

export function detectDesktopPlatform(userAgent = '', platform = '', maxTouchPoints = 0): DesktopPlatform {
  const agent = userAgent.toLowerCase();
  const source = `${userAgent} ${platform}`.toLowerCase();
  const isIPadDesktopMode = /mac/.test(platform.toLowerCase()) && maxTouchPoints > 1;

  if (/android|iphone|ipad|ipod/.test(agent) || isIPadDesktopMode) return 'other';
  if (/windows|win32|win64/.test(source)) return 'windows';
  if (/macintosh|mac os x|macintel|macppc/.test(source)) return 'macos';
  return 'other';
}

function getBrowserPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'other';
  return detectDesktopPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

function Brand() {
  return (
    <a className="mova-landing-brand" href="/" aria-label="Mova — главная">
      <img src="/mova-logo.png" alt="" />
      <strong>Mova</strong>
    </a>
  );
}

function PlatformDownload({ platform, id }: { platform: DesktopPlatform; id?: string }) {
  const preferred = downloads.find((download) => download.platform === platform);
  const PreferredIcon = preferred?.icon ?? Download;
  const primaryLabel = preferred ? `Скачать для ${preferred.name}` : 'Выбрать версию';
  const alternativesRef = useRef<HTMLDetailsElement>(null);
  const primaryContent = (
    <>
      <span className="mova-platform-download__icon"><PreferredIcon size={20} /></span>
      <span className="mova-platform-download__copy">
        <small>{preferred ? 'Для вашего устройства' : 'Windows или macOS'}</small>
        <strong>{primaryLabel}</strong>
      </span>
      {preferred ? <Download className="mova-platform-download__action" size={19} /> : <ArrowRight className="mova-platform-download__action" size={19} />}
    </>
  );

  const openPlatformMenu = () => {
    if (!alternativesRef.current) return;
    alternativesRef.current.open = true;
    alternativesRef.current.querySelector('summary')?.focus();
  };

  return (
    <div className="mova-platform-download" id={id} data-detected-platform={platform}>
      {preferred ? (
        <a className="mova-platform-download__primary" href={preferred.href}>{primaryContent}</a>
      ) : (
        <button className="mova-platform-download__primary" type="button" onClick={openPlatformMenu}>{primaryContent}</button>
      )}

      <details className="mova-platform-download__alternatives" ref={alternativesRef}>
        <summary>
          <span>Другие платформы</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="mova-platform-download__menu">
          {downloads.map(({ name, detail, href, icon: Icon }) => (
            <a key={name} href={href}>
              <Icon size={18} />
              <span><strong>{name}</strong><small>{detail}</small></span>
              <Download size={16} />
            </a>
          ))}
          <a href="/app">
            <Globe2 size={18} />
            <span><strong>Web-версия</strong><small>Без установки</small></span>
            <ArrowRight size={16} />
          </a>
        </div>
      </details>
    </div>
  );
}

export function LandingPage() {
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [platform] = useState<DesktopPlatform>(getBrowserPlatform);
  const secretVideoRef = useRef<HTMLVideoElement>(null);

  const openSecretVideo = () => {
    const video = secretVideoRef.current;
    if (video) {
      video.currentTime = 0;
      const playback = video.play();
      if (playback) void playback.catch(() => undefined);
    }
    setIsVideoOpen(true);
  };

  const closeSecretVideo = () => {
    const video = secretVideoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setIsVideoOpen(false);
  };

  return (
    <div className="mova-landing">
      <header className="mova-landing-header">
        <nav className="mova-landing-nav" aria-label="Основная навигация">
          <Brand />
          <div className="mova-landing-nav__links">
            <a href="#features">Возможности</a>
            <a href="#download">Скачать</a>
            <a href="#story">О проекте</a>
            <a href={githubUrl} target="_blank" rel="noreferrer"><Code2 size={15} /> GitHub</a>
          </div>
        </nav>
      </header>

      <main>
        <section className="mova-landing-hero" aria-labelledby="hero-title">
          <div className="mova-landing-hero__copy">
            <span className="mova-landing-eyebrow"><Radio size={14} /> Mova · web и desktop</span>
            <h1 id="hero-title">Общайтесь.<br />Созванивайтесь.<br /><span>Делитесь экраном.</span></h1>
            <p>Личные и групповые чаты, голосовые и видеозвонки — в браузере и отдельном приложении.</p>
            <div className="mova-landing-actions">
              <a className="mova-landing-action-primary" href="/app">Открыть Mova <ArrowRight size={18} /></a>
              <PlatformDownload platform={platform} id="download" />
            </div>
            <ul className="mova-landing-hero__facts" aria-label="Основные возможности Mova">
              <li><MessageCircleMore size={15} /> Личные и групповые чаты</li>
              <li><Video size={15} /> Голос и видео</li>
              <li><ScreenShare size={15} /> Демонстрация экрана</li>
            </ul>
          </div>

          <figure className="mova-landing-hero__product">
            <div className="mova-landing-product-window">
              <div className="mova-landing-product-window__bar">
                <span><i /><i /><i /></span>
                <small>mova · диалог</small>
                <em><Radio size={12} /> Настоящий интерфейс</em>
              </div>
              <img src="/mova-interface.png" alt="Настоящий интерфейс диалога в Mova" />
            </div>
            <div className="mova-landing-hero__call-preview">
              <img src="/mova-call.png" alt="Настоящий интерфейс голосового звонка в Mova" />
              <span><i /> Звонок в Mova</span>
            </div>
            <figcaption><MessageCircleMore size={17} /><span><strong>Разговор остаётся в центре</strong><small>Сообщения, изображения, файлы и звонки — без лишнего шума.</small></span></figcaption>
          </figure>
        </section>

        <section className="mova-landing-features" id="features" aria-labelledby="features-title">
          <header className="mova-landing-section-heading is-centered">
            <span>Настоящий продукт</span>
            <h2 id="features-title">Всё нужное для разговора</h2>
            <p>Показываем текущий интерфейс Mova и только те возможности, которыми уже можно пользоваться.</p>
          </header>

          <article className="mova-landing-feature-scene">
            <div className="mova-landing-feature-scene__copy">
              <i><MessageCircleMore size={23} /></i>
              <span>Переписка</span>
              <h3>Сообщения без лишней сложности</h3>
              <p>Личные и групповые чаты с ответами, редактированием, изображениями, файлами, ссылками и emoji.</p>
              <ul>
                <li>Сообщения приходят в реальном времени</li>
                <li>Медиа и файлы остаются внутри диалога</li>
                <li>Статусы помогают понять, кто сейчас на связи</li>
              </ul>
            </div>
            <figure className="mova-landing-feature-scene__media">
              <img src="/mova-interface.png" alt="Диалог в Mova с сообщениями, изображениями и ссылками" />
            </figure>
          </article>

          <article className="mova-landing-feature-scene is-reversed">
            <div className="mova-landing-feature-scene__copy">
              <i><Video size={23} /></i>
              <span>Созвоны</span>
              <h3>От текста к голосу — в том же приложении</h3>
              <p>Голосовые и видеозвонки, демонстрация экрана и чат во время разговора собраны в одном пространстве.</p>
              <ul>
                <li>Голосовые и видеозвонки</li>
                <li>Демонстрация экрана собеседникам</li>
                <li>Переписка доступна прямо во время звонка</li>
              </ul>
            </div>
            <figure className="mova-landing-feature-scene__media">
              <img src="/mova-call.png" alt="Активный голосовой звонок между двумя пользователями Mova" />
            </figure>
          </article>

          <ul className="mova-landing-capabilities" aria-label="Дополнительные возможности">
            <li><MessageCircleMore size={21} /><span><strong>Групповые чаты</strong><small>Один диалог для всей компании.</small></span></li>
            <li><ScreenShare size={21} /><span><strong>Демонстрация экрана</strong><small>Показывайте собеседникам, что происходит у вас.</small></span></li>
            <li><Laptop size={21} /><span><strong>Web и desktop</strong><small>Открывайте Mova там, где удобнее.</small></span></li>
          </ul>
        </section>

        <section className="mova-landing-story" id="story" aria-labelledby="story-title">
          <article className="mova-landing-story__main">
            <div>
              <span>О проекте</span>
              <h2 id="story-title">Небольшая идея стала рабочей Mova</h2>
              <p>Mova начиналась как запасной чат для своей компании. Постепенно появились группы, файлы, звонки, демонстрация экрана и отдельный desktop-клиент.</p>
              <p>Проект остаётся независимым: без громких обещаний — только понятные функции, которыми уже можно пользоваться.</p>
              <a href={githubUrl} target="_blank" rel="noreferrer"><Code2 size={17} /> Посмотреть проект на GitHub</a>
            </div>
            <figure><img src="/mova-character-peek.png" alt="Мая — персонаж проекта Mova" /></figure>
          </article>

          <div className="mova-landing-story__side">
            <article className="mova-landing-support-card">
              <i><Heart size={21} /></i>
              <span>Поддержка проекта</span>
              <h3>Помочь Mova развиваться</h3>
              <p>Поддержка помогает оплачивать серверы и сохранять базовое использование без обязательной подписки.</p>
              <a href={donationUrl} target="_blank" rel="noreferrer">Поддержать проект <ArrowRight size={16} /></a>
            </article>

            <button className="mova-landing-secret-card" type="button" onClick={openSecretVideo} aria-label="Открыть секретное видео">
              <img src="/mova-secret-poster.png" alt="" />
              <span className="mova-landing-secret-card__play"><Play size={19} fill="currentColor" /></span>
              <span><small>Небольшая пасхалка</small><strong>12 секунд отдыха</strong></span>
            </button>
          </div>
        </section>

        <section className="mova-landing-cta" aria-labelledby="cta-title">
          <div>
            <span>Можно начинать</span>
            <h2 id="cta-title">Откройте Mova там, где вам удобно</h2>
            <p>Браузер — для быстрого старта. Desktop-приложение — когда Mova нужна каждый день.</p>
          </div>
          <div className="mova-landing-cta__actions">
            <a className="mova-landing-action-primary" href="/app">Открыть web-версию <ArrowRight size={18} /></a>
            <PlatformDownload platform={platform} />
          </div>
        </section>
      </main>

      <footer className="mova-landing-footer">
        <div className="mova-landing-footer__top">
          <div className="mova-landing-footer__about">
            <Brand />
            <p>Чаты, звонки и демонстрация экрана — в браузере и desktop-приложении.</p>
          </div>
          <nav className="mova-landing-footer__links" aria-label="Навигация в подвале">
            <div><strong>Продукт</strong><a href="/app">Web-версия</a><a href="#download">Скачать</a><a href="#features">Возможности</a></div>
            <div><strong>Проект</strong><a href="#story">О проекте</a><a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a><a href={donationUrl} target="_blank" rel="noreferrer">Поддержать</a></div>
            <div><strong>Связаться</strong><span>@yuuta4ka</span><a href={githubUrl} target="_blank" rel="noreferrer">Сообщить о баге</a></div>
          </nav>
        </div>
        <div className="mova-landing-footer__meta"><span>© 2026 Mova</span><span>Общайтесь, созванивайтесь, оставайтесь на связи.</span></div>
        <div className="mova-landing-footer__word" aria-hidden="true">Mova</div>
      </footer>

      <div
        className={`mova-landing-video-modal${isVideoOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal={isVideoOpen ? 'true' : undefined}
        aria-hidden={!isVideoOpen}
        aria-labelledby="video-modal-title"
        inert={!isVideoOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSecretVideo();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') closeSecretVideo();
        }}
      >
        <div className="mova-landing-video-modal__panel">
          <header><div><span>Ваша награда</span><h2 id="video-modal-title">Секретное видео</h2></div><button type="button" onClick={closeSecretVideo} aria-label="Закрыть видео"><X size={20} /></button></header>
          <video ref={secretVideoRef} controls playsInline preload="metadata" poster="/mova-secret-poster.png">
            <source src="/mova-secret-mobile-v2.mp4" type="video/mp4" />
            <source src="/mova-secret.mp4" type="video/mp4" />
            Ваш браузер не поддерживает видео. <a href="/mova-secret.mp4">Открыть файл</a>.
          </video>
        </div>
      </div>
    </div>
  );
}
