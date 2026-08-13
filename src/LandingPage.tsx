import {
  ArrowRight,
  Download,
  Code2,
  Globe2,
  Heart,
  Laptop,
  MessageCircleMore,
  MonitorDown,
  PhoneCall,
  Radio,
  ScreenShare,
  Sparkles,
  Video,
} from 'lucide-react';

const version = '0.1.7';
const releaseTag = '0.1.7';
const githubUrl = 'https://github.com/yuuta4ka/mova';
const donationUrl = 'https://donatex.gg/donate/yuuta';
const releaseBase = `https://github.com/yuuta4ka/mova/releases/download/v${releaseTag}`;

const downloads = [
  {
    name: 'Windows',
    detail: 'Windows 10 и 11 · x64',
    meta: `Версия ${version} · EXE`,
    href: `${releaseBase}/Mova%20Setup%20${version}.exe`,
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

function Brand() {
  return (
    <a className="mova-landing-brand" href="/" aria-label="Mova — главная">
      <img src="/mova-logo.png" alt="" />
      <strong>Mova</strong>
    </a>
  );
}

export function LandingPage() {
  return (
    <div className="mova-landing">
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

          <aside className="mova-landing-hero__aside" aria-label="Коротко о Mova">
            <span>В Mova уже есть</span>
            <div><MessageCircleMore size={19} /><strong>Чаты</strong><small>личные и групповые</small></div>
            <div><PhoneCall size={19} /><strong>Звонки</strong><small>голос и видео</small></div>
            <div><ScreenShare size={19} /><strong>Экран</strong><small>можно показать другим</small></div>
            <p>Работает в браузере и как desktop-приложение.</p>
          </aside>
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

        <section className="mova-landing-ai" aria-labelledby="ai-title">
          <div className="mova-landing-ai__icon"><Sparkles size={24} /></div>
          <div>
            <span>Да, в основном через vibecoding</span>
            <h2 id="ai-title">Сделано с AI. Серьёзно.</h2>
            <p>Я описывал нейросетям, что хочу получить, запускал код, находил странности и переделывал интерфейс. Несколько недель вечерней возни с AI и Codex каким-то образом превратились в backend, realtime-чаты, звонки, screen sharing и desktop-клиент.</p>
            <p>Не технологический переворот. Просто забавно, что этой штукой теперь реально можно пользоваться.</p>
          </div>
          <a href={githubUrl} target="_blank" rel="noreferrer"><Code2 size={17} /> Посмотреть код</a>
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
      </main>

      <footer className="mova-landing-footer">
        <Brand />
        <p>Небольшой независимый мессенджер. Сделан по вечерам.</p>
        <div><a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a><a href="/app">Web-версия</a><span>© 2026 Mova</span></div>
      </footer>
    </div>
  );
}
