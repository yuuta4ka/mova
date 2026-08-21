import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Code2,
  Globe2,
  Heart,
  Laptop,
  MessageCircleMore,
  MonitorDown,
  Play,
  Radio,
  ScreenShare,
  Sparkles,
  Video,
  X,
} from 'lucide-react';

const version = '0.1.9';
const releaseTag = '0.1.9';
const githubUrl = 'https://github.com/yuuta4ka/mova';
const donationUrl = 'https://donatex.gg/donate/yuuta';
const releaseBase = `https://github.com/yuuta4ka/mova/releases/download/v${releaseTag}`;

const downloads = [
  {
    name: 'Windows',
    detail: 'Windows 10 и 11 · x64',
    meta: `Версия ${version} · EXE`,
    href: `${releaseBase}/Mova.Setup.${version}.exe`,
    icon: MonitorDown,
  },
  {
    name: 'macOS',
    detail: 'Mac с Apple Silicon',
    meta: `Версия ${version} · DMG`,
    href: `${releaseBase}/Mova-${version}-arm64.dmg`,
    icon: Laptop,
  },
];

const featureGroups = [
  {
    icon: MessageCircleMore,
    title: 'Переписка',
    description: 'Личные и групповые чаты без лишней сложности.',
    items: ['Ответы и редактирование', 'Emoji, изображения и файлы', 'Сообщения в реальном времени'],
  },
  {
    icon: Video,
    title: 'Созвоны',
    description: 'Когда текста уже мало, можно просто позвонить.',
    items: ['Голос и видео', 'Демонстрация экрана', 'Чат прямо во время звонка'],
  },
  {
    icon: Laptop,
    title: 'На нужном устройстве',
    description: 'Открывается в браузере или отдельным приложением.',
    items: ['Desktop-клиент', 'Web-версия', 'Статусы пользователей'],
  },
];

const projectTimeline = [
  {
    icon: MessageCircleMore,
    title: 'Сначала — чат',
    description: 'Запасное место для переписки со своей компанией.',
  },
  {
    icon: Video,
    title: 'Потом — звонки',
    description: 'Голос и видео появились, когда одного текста стало мало.',
  },
  {
    icon: ScreenShare,
    title: 'Следом — экран',
    description: 'Демонстрация экрана превратила чат в место для совместных дел.',
  },
  {
    icon: Laptop,
    title: 'И desktop-клиент',
    description: 'В итоге Mova вышла из вкладки браузера в отдельное приложение.',
  },
];

function Brand() {
  return (
    <a className="mova-landing-brand" href="/" aria-label="Mova — главная">
      <img src="/mova-logo.png" alt="" />
      <strong>Mova</strong>
    </a>
  );
}

export function LandingPage() {
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const landingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = landingRef.current;
    if (!root) return;
    const targets = [...root.querySelectorAll<HTMLElement>([
      '.mova-landing-showcase>header',
      '.mova-landing-showcase figure',
      '.mova-landing-why>*',
      '.mova-landing-timeline>.mova-landing-section-heading',
      '.mova-landing-timeline li',
      '.mova-landing-features>.mova-landing-section-heading',
      '.mova-landing-features article',
      '.mova-landing-ai-scene>*',
      '.mova-landing-download>header',
      '.mova-landing-download__layout>*',
      '.mova-landing-support>article',
      '.mova-landing-finale>*',
    ].join(','))];
    targets.forEach((target, index) => {
      target.classList.add('mova-landing-reveal');
      target.style.setProperty('--mova-reveal-delay', `${(index % 4) * 55}ms`);
    });

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion || !('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('is-revealed'));
      return;
    }

    root.classList.add('is-reveal-ready');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mova-landing" ref={landingRef}>
      <header className="mova-landing-header">
        <nav className="mova-landing-nav" aria-label="Основная навигация">
          <Brand />
          <div className="mova-landing-nav__links">
            <a href="#features">Возможности</a>
            <a href="#story">О проекте</a>
            <a href={githubUrl} target="_blank" rel="noreferrer"><Code2 size={15} /> GitHub</a>
          </div>
          <a className="mova-landing-nav__app" href="/app">Открыть Mova <ArrowRight size={15} /></a>
        </nav>
      </header>

      <main>
        <section className="mova-landing-hero" aria-labelledby="hero-title">
          <div className="mova-landing-hero__copy">
            <span className="mova-landing-eyebrow"><Sparkles size={14} /> Pet-project, который немного разросся</span>
            <h1 id="hero-title"><span>Mova</span>Мессенджер, сделанный по вечерам.</h1>
            <p>Vibecode-проект, который за несколько недель вырос в рабочий мессенджер с чатами, звонками и демонстрацией экрана.</p>
            <p className="mova-landing-hero__note">Не полная замена Telegram или Discord. Просто нормальная альтернатива на случай проблем с доступом.</p>
            <div className="mova-landing-actions">
              <a className="is-primary" href="/app">Открыть Mova <ArrowRight size={17} /></a>
              <a href="#download"><Download size={17} /> Скачать приложение</a>
            </div>
          </div>

          <figure className="mova-landing-hero__product">
            <div className="mova-landing-hero__product-bar">
              <span><i /><i /><i /> mova · диалог</span>
              <small><Radio size={12} /> Настоящий интерфейс</small>
            </div>
            <div className="mova-landing-hero__product-image">
              <img src="/mova-interface.png" alt="Фрагмент настоящего интерфейса Mova в первом экране" />
            </div>
            <figcaption><MessageCircleMore size={17} /><span><strong>Переписка без лишнего шума</strong><small>Сообщения, изображения, ссылки и emoji</small></span></figcaption>
          </figure>
        </section>

        <section className="mova-landing-showcase" aria-labelledby="showcase-title">
          <header>
            <div><span>Настоящий интерфейс</span><h2 id="showcase-title">Диалоги и звонки в Mova</h2></div>
            <p>Оба скриншота сняты в текущей версии приложения на локальных демонстрационных аккаунтах.</p>
          </header>
          <div className="mova-landing-showcase__grid">
            <figure>
              <img src="/mova-interface.png" alt="Диалог в Mova с текстом, ссылкой, изображением и эмодзи" />
              <figcaption><i /> Диалог · ссылки, изображения и emoji</figcaption>
            </figure>
            <figure>
              <img src="/mova-call.png" alt="Активный голосовой звонок между двумя пользователями Mova" />
              <figcaption><i /> Голосовой звонок · текущий интерфейс</figcaption>
            </figure>
          </div>
        </section>

        <section className="mova-landing-why" id="story" aria-labelledby="why-title">
          <div className="mova-landing-section-heading">
            <span>О проекте</span>
            <h2 id="why-title">Зачем ещё один мессенджер?</h2>
          </div>
          <div className="mova-landing-why__copy">
            <p className="is-lead">Не потому, что Telegram или Discord плохие. Они отличные.</p>
            <p>Просто привычный сервис сегодня может работать нормально, а завтра им уже сложно пользоваться. Mova появилась как запасной вариант для своей компании: переписываться, созваниваться и показывать экран, когда основной мессенджер недоступен или работает нестабильно.</p>
            <p>Это не полная замена Telegram или Discord и пока не пытается ею быть.</p>
          </div>
          <blockquote>«Сделаю небольшой запасной чат для своих». Несколько недель спустя у него появились видеозвонки и desktop-клиент.</blockquote>
        </section>

        <section className="mova-landing-timeline" aria-labelledby="timeline-title">
          <div className="mova-landing-section-heading">
            <span>Как всё разрослось</span>
            <h2 id="timeline-title">От маленького чата до полноценной Mova</h2>
            <p>Без большого плана и презентаций для инвесторов. Просто одна полезная вещь постепенно потянула за собой следующую.</p>
          </div>
          <ol>
            {projectTimeline.map(({ icon: Icon, title, description }, index) => (
              <li key={title}>
                <i><Icon size={19} /></i>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mova-landing-features" id="features" aria-labelledby="features-title">
          <div className="mova-landing-section-heading">
            <span>Что уже работает</span>
            <h2 id="features-title">Всё основное уже на месте</h2>
            <p>Без обещаний на десять лет вперёд. Только то, чем в Mova можно пользоваться сейчас.</p>
          </div>
          <div className="mova-landing-features__grid">
            {featureGroups.map(({ icon: Icon, title, description, items }) => (
              <article key={title}>
                <i><Icon size={21} /></i>
                <h3>{title}</h3>
                <p>{description}</p>
                <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mova-landing-ai-scene" aria-labelledby="ai-title">
          <div className="mova-landing-ai-scene__character">
            <img src="/mova-character-peek.png" alt="Мая выглядывает из-за блока о создании Mova" />
          </div>
          <div className="mova-landing-ai">
            <div className="mova-landing-ai__icon"><Sparkles size={24} /></div>
            <div>
              <span>Да, в основном через vibecoding</span>
              <h2 id="ai-title">Сделано с AI. Серьёзно.</h2>
              <p>Я описывал нейросетям, что хочу получить, запускал код, находил странности и переделывал интерфейс. Несколько недель вечерней возни с AI и Codex каким-то образом превратились в backend, realtime-чаты, звонки, screen sharing и desktop-клиент.</p>
              <p>Не технологический переворот. Просто забавно, что этой штукой теперь реально можно пользоваться.</p>
            </div>
            <a href={githubUrl} target="_blank" rel="noreferrer"><Code2 size={17} /> Посмотреть код</a>
          </div>
        </section>

        <section className="mova-landing-download" id="download" aria-labelledby="download-title">
          <header>
            <div className="mova-landing-section-heading">
              <span>Попробовать Mova</span>
              <h2 id="download-title">В браузере или отдельным приложением</h2>
            </div>
            <p>Для быстрого старта откройте web-версию. Для постоянного использования есть приложения для Windows и Mac.</p>
          </header>

          <div className="mova-landing-download__layout">
            <a className="mova-landing-web-card" href="/app">
              <i><Globe2 size={25} /></i>
              <span><small>Установка не нужна</small><strong>Открыть Mova в браузере</strong><em>Web-версия работает прямо на этом сайте.</em></span>
              <ArrowRight size={20} />
            </a>

            <div className="mova-landing-download__desktop" aria-label="Desktop-приложения">
              {downloads.map(({ name, detail, meta, href, icon: Icon }) => (
                <a key={name} href={href}>
                  <i><Icon size={22} /></i>
                  <span><strong>{name}</strong><small>{detail}</small></span>
                  <em>{meta}</em>
                  <Download size={18} />
                </a>
              ))}
            </div>
          </div>

          <p className="mova-landing-download__release"><Radio size={14} /> Установщики ведут на опубликованный релиз Mova {version} в GitHub.</p>
        </section>

        <section className="mova-landing-support" aria-label="Поддержка и обратная связь">
          <article className="mova-landing-support__donation">
            <i><Heart size={22} /></i>
            <div>
              <span>Поддержка проекта</span>
              <h2>Поддержать Mova</h2>
              <p>Mova — независимый pet-project. Поддержка помогает оплачивать серверы, продолжать развитие и сохранять базовое использование без обязательных подписок.</p>
            </div>
            <a href={donationUrl} target="_blank" rel="noreferrer">Поддержать проект <ArrowRight size={16} /></a>
          </article>

          <article className="mova-landing-support__feedback">
            <div>
              <span>Обратная связь</span>
              <h2>Нашли баг или есть идея?</h2>
              <p>Напишите об ошибке, предложите новую функцию или поделитесь впечатлениями о проекте.</p>
            </div>
            <div className="mova-landing-support__links">
              <span className="mova-landing-support__username"><MessageCircleMore size={16} /> @yuuta4ka</span>
              <a href={githubUrl} target="_blank" rel="noreferrer"><Code2 size={15} /> GitHub</a>
            </div>
          </article>
        </section>

        <section className="mova-landing-finale" aria-labelledby="finale-title">
          <div className="mova-landing-finale__copy">
            <span><CheckCircle2 size={15} /> Финишная прямая пройдена</span>
            <h2 id="finale-title">Поздравляем — вы пролистали сайт до самого конца.</h2>
            <p>За такое полагается маленькая награда. Нажмите на карточку, чтобы посмотреть секретное видео.</p>
          </div>
          <button className="mova-landing-finale__video" type="button" onClick={() => setIsVideoOpen(true)} aria-label="Открыть секретное видео">
            <img src="/mova-secret-poster.png" alt="Кадр из секретного видео с котом" />
            <span className="mova-landing-finale__play"><Play size={24} fill="currentColor" /></span>
            <span className="mova-landing-finale__caption"><strong>Посмотреть видео</strong><small>12 секунд заслуженного отдыха</small></span>
          </button>
        </section>
      </main>

      <footer className="mova-landing-footer">
        <div className="mova-landing-footer__top">
          <div className="mova-landing-footer__about">
            <Brand />
            <p>Небольшой независимый мессенджер. Сделан по вечерам.</p>
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

      {isVideoOpen ? (
        <div
          className="mova-landing-video-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsVideoOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsVideoOpen(false);
          }}
        >
          <div className="mova-landing-video-modal__panel">
            <header><div><span>Ваша награда</span><h2 id="video-modal-title">Секретное видео</h2></div><button type="button" autoFocus onClick={() => setIsVideoOpen(false)} aria-label="Закрыть видео"><X size={20} /></button></header>
            <video controls autoPlay playsInline poster="/mova-secret-poster.png">
              <source src="/mova-secret.mp4" type="video/mp4" />
              Ваш браузер не поддерживает видео. <a href="/mova-secret.mp4">Открыть файл</a>.
            </video>
          </div>
        </div>
      ) : null}
    </div>
  );
}
