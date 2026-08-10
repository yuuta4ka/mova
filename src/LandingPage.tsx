import {
  ArrowRight,
  Check,
  Download,
  Globe2,
  Headphones,
  Laptop,
  MessageCircleMore,
  MonitorDown,
  PhoneCall,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

const version = '0.1.0';
const releaseBase = 'https://github.com/yuuta4ka/mova/releases/latest/download';

const downloads = [
  {
    name: 'Windows',
    detail: 'Windows 10 и 11 · x64',
    meta: `Версия ${version} · EXE`,
    href: `${releaseBase}/Mova-Setup-${version}.exe`,
    icon: MonitorDown,
    primary: true,
  },
  {
    name: 'macOS',
    detail: 'Mac с Apple Silicon',
    meta: `Версия ${version} · DMG`,
    href: `${releaseBase}/Mova-${version}-arm64.dmg`,
    icon: Laptop,
  },
  {
    name: 'Веб-версия',
    detail: 'Откроется прямо в браузере',
    meta: 'Установка не требуется',
    href: '/app',
    icon: Globe2,
  },
];

function Brand() {
  return (
    <a className="mova-landing-brand" href="/" aria-label="Mova — главная">
      <span>M</span>
      <strong>Mova</strong>
    </a>
  );
}

function ProductPreview() {
  return (
    <div className="mova-landing-preview" aria-label="Интерфейс Mova">
      <div className="mova-landing-preview__bar">
        <i /><i /><i />
        <span>Mova</span>
      </div>
      <div className="mova-landing-preview__body">
        <aside>
          <div className="mova-landing-preview__profile"><b>Ю</b><span><strong>Юта</strong><small>в сети</small></span></div>
          <label>Чаты</label>
          <div className="is-active"><b>А</b><span><strong>Аня</strong><small>Увидимся вечером?</small></span><time>20:41</time></div>
          <div><b>М</b><span><strong>Макс</strong><small>Отправил фотографию</small></span><time>19:12</time></div>
          <div><b>К</b><span><strong>Команда</strong><small>Созвон через 10 минут</small></span><time>18:30</time></div>
        </aside>
        <section>
          <header><b>А</b><span><strong>Аня</strong><small>в сети</small></span><PhoneCall size={15} /></header>
          <div className="mova-landing-preview__messages">
            <p><span>Привет! Как прошёл день?</span><small>20:39</small></p>
            <p className="is-own"><span>Отлично. Покажу всё на созвоне ✨</span><small>20:40</small></p>
            <p><span>Тогда увидимся вечером</span><small>20:41</small></p>
          </div>
          <footer><span>Сообщение</span><i>→</i></footer>
        </section>
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <main className="mova-landing">
      <nav className="mova-landing-nav">
        <Brand />
        <div>
          <a href="#about">О Mova</a>
          <a href="#download">Скачать</a>
          <a className="mova-landing-nav__app" href="/app">Открыть Mova <ArrowRight size={14} /></a>
        </div>
      </nav>

      <section className="mova-landing-hero">
        <div className="mova-landing-hero__copy">
          <span className="mova-landing-eyebrow"><Sparkles size={14} /> Пространство для своих</span>
          <h1>Общайтесь.<br />Созванивайтесь.<br /><em>Оставайтесь рядом.</em></h1>
          <p>Mova — спокойный мессенджер для личных и групповых чатов, голосовых звонков и совместных моментов.</p>
          <div className="mova-landing-actions">
            <a className="is-primary" href={`${releaseBase}/Mova-Setup-${version}.exe`}>
              <Download size={17} /> Скачать для Windows
            </a>
            <a href="/app">Открыть веб-версию <ArrowRight size={16} /></a>
          </div>
          <small><Check size={13} /> Бесплатно · Windows · macOS · Web</small>
        </div>
        <ProductPreview />
      </section>

      <section className="mova-landing-features" id="about" aria-label="Возможности Mova">
        <article>
          <MessageCircleMore size={20} />
          <div><h2>Личные и групповые чаты</h2><p>Переписка, файлы, ответы и реакции — всё на своём месте.</p></div>
        </article>
        <article>
          <Headphones size={20} />
          <div><h2>Голосовые звонки</h2><p>Созванивайтесь один на один или всей компанией.</p></div>
        </article>
        <article>
          <ShieldCheck size={20} />
          <div><h2>Без лишнего шума</h2><p>Чистый интерфейс, быстрый вход и только важные функции.</p></div>
        </article>
      </section>

      <section className="mova-landing-download" id="download">
        <header>
          <span>Скачать Mova</span>
          <h2>Выберите свою платформу</h2>
          <p>Один аккаунт и все ваши чаты — в приложении или браузере.</p>
        </header>
        <div className="mova-landing-download__grid">
          {downloads.map(({ name, detail, meta, href, icon: Icon, primary }) => (
            <a key={name} className={primary ? 'is-primary' : ''} href={href}>
              <i><Icon size={23} /></i>
              <span><strong>{name}</strong><small>{detail}</small></span>
              <em>{meta}</em>
              {href === '/app' ? <ArrowRight size={18} /> : <Download size={18} />}
            </a>
          ))}
        </div>
      </section>

      <footer className="mova-landing-footer">
        <Brand />
        <p>Место, где вас слышат.</p>
        <span>© 2026 Mova</span>
      </footer>
    </main>
  );
}
