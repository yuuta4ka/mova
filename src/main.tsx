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
import { RealApp } from './RealApp';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RealApp /></React.StrictMode>);
