import { appendFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
})[character]);

function emailDocument(title, description, code, hint) {
  return `<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:32px 16px;background:#10131a;color:#f5f5f6;font-family:Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;padding:32px;background:#191c24;border:1px solid #2d3039;border-radius:24px">
      <div style="font-size:25px;font-weight:700">Mova</div>
      <h1 style="margin:28px 0 10px;font-size:22px">${escapeHtml(title)}</h1>
      <p style="margin:0;color:#b7bbc5;font-size:15px;line-height:1.55">${escapeHtml(description)}</p>
      <div style="margin:28px 0;padding:18px;text-align:center;background:#12151b;border-radius:16px;font-size:34px;font-weight:700;letter-spacing:8px;color:#ffffff">${escapeHtml(code)}</div>
      <p style="margin:0;color:#858b96;font-size:13px;line-height:1.5">${escapeHtml(hint)}</p>
    </div>
  </body>
</html>`;
}

export function createEmailService({ logger }) {
  const testPath = String(process.env.MOVA_EMAIL_TEST_PATH || '').trim();
  const consoleMode = process.env.MOVA_EMAIL_MODE === 'console';
  const smtpUrl = String(process.env.MOVA_SMTP_URL || '').trim();
  const smtpHost = String(process.env.MOVA_SMTP_HOST || '').trim();
  const from = String(process.env.MOVA_EMAIL_FROM || 'Mova <no-reply@hola-mova.ru>').trim();
  const transport = smtpUrl
    ? nodemailer.createTransport(smtpUrl)
    : smtpHost
      ? nodemailer.createTransport({
          host: smtpHost,
          port: Math.max(1, Number(process.env.MOVA_SMTP_PORT || 587)),
          secure: String(process.env.MOVA_SMTP_SECURE || '').toLowerCase() === 'true',
          ...(process.env.MOVA_SMTP_USER
            ? { auth: { user: process.env.MOVA_SMTP_USER, pass: process.env.MOVA_SMTP_PASSWORD || '' } }
            : {}),
        })
      : null;
  const configured = Boolean(testPath || consoleMode || transport);

  async function deliver({ to, subject, text, html, purpose, code }) {
    if (testPath) {
      await appendFile(testPath, `${JSON.stringify({ to, subject, text, purpose, code, sentAt: new Date().toISOString() })}\n`, { encoding: 'utf8', mode: 0o600 });
      return;
    }
    if (consoleMode) {
      process.stdout.write(`[Mova email] ${purpose} -> ${to}: ${code}\n`);
      return;
    }
    if (!transport) throw Object.assign(new Error('Отправка писем пока не настроена'), { statusCode: 503 });
    await transport.sendMail({ from, to, subject, text, html });
  }

  async function sendCode({ to, code, purpose }) {
    const messages = {
      registration: {
        subject: 'Код подтверждения Mova',
        title: 'Подтвердите почту',
        description: 'Введите этот код в Mova, чтобы завершить регистрацию.',
      },
      password_reset: {
        subject: 'Восстановление пароля Mova',
        title: 'Сброс пароля',
        description: 'Введите этот код в Mova, чтобы задать новый пароль.',
      },
      email_change: {
        subject: 'Подтверждение новой почты Mova',
        title: 'Подтвердите новую почту',
        description: 'Введите этот код в настройках Mova, чтобы изменить адрес аккаунта.',
      },
    };
    const message = messages[purpose];
    if (!message) throw new Error('Unknown email code purpose');
    const hint = 'Код действует 10 минут. Если вы не запрашивали его, просто проигнорируйте письмо.';
    await deliver({
      to,
      purpose,
      code,
      subject: message.subject,
      text: `${message.title}\n\nКод: ${code}\n\n${hint}`,
      html: emailDocument(message.title, message.description, code, hint),
    });
  }

  async function sendEmailChangedNotice({ to, newEmail }) {
    if (!configured) return;
    const subject = 'Почта аккаунта Mova изменена';
    const text = `Почта вашего аккаунта Mova изменена на ${newEmail}. Если это были не вы, как можно скорее восстановите пароль.`;
    try {
      if (testPath) {
        await appendFile(testPath, `${JSON.stringify({ to, subject, text, purpose: 'email_changed_notice', sentAt: new Date().toISOString() })}\n`, { encoding: 'utf8', mode: 0o600 });
      } else if (consoleMode) {
        process.stdout.write(`[Mova email] email_changed_notice -> ${to}\n`);
      } else {
        await transport.sendMail({ from, to, subject, text });
      }
    } catch (error) {
      logger.warn('email.change_notice_failed', { error });
    }
  }

  return { configured, sendCode, sendEmailChangedNotice };
}
