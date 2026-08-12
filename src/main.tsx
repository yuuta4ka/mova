import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import './styles.css';
import './telegram.css';
import './chat-functional.css';
import './settings.css';
import './call.css';
import './input-focus.css';
import './auth.css';
import './landing.css';
import './polish.css';
import './brand.css';
import './desktop-shell.css';
import './composer.css';
import './media-viewer.css';
import './common-ui.css';
import './maintenance.css';
import { RealApp } from './RealApp';
import { LandingPage } from './LandingPage';
import { DesktopTitlebar } from './DesktopTitlebar';
import { ToastProvider } from './components/Primitives';

const appRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
const windowsDesktop = window.movaDesktopShell?.platform === 'win32';
document.documentElement.classList.toggle('mova-landing-document', !appRoute);
document.documentElement.classList.toggle('mova-windows-desktop', windowsDesktop);
const content = appRoute ? <ToastProvider><RealApp /></ToastProvider> : <LandingPage />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {windowsDesktop ? (
      <div className="mova-desktop-layout">
        <DesktopTitlebar />
        <div className="mova-desktop-content">{content}</div>
      </div>
    ) : content}
  </React.StrictMode>,
);
