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
import { RealApp } from './RealApp';
import { LandingPage } from './LandingPage';

const appRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
document.documentElement.classList.toggle('mova-landing-document', !appRoute);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{appRoute ? <RealApp /> : <LandingPage />}</React.StrictMode>,
);
