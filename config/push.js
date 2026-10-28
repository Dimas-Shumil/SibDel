import { createHash } from 'node:crypto';
import { env } from './env.js';
export const CONSENT_VERSION = 'sibdel-push-marketing-2026-10-28-' + createHash('sha256').update(env.PUSH_MARKETING_SENDER).digest('hex').slice(0, 12);
export const CONSENT_TEXT = 'Рекламораспространитель: ' + (env.PUSH_MARKETING_SENDER || 'не указан; реклама отключена') + '. Я согласен получать рекламные PUSH-уведомления интернет-магазина «Сибирские Деликатесы» (sib-del.ru): акции, скидки, новые товары и специальные предложения. Для рассылки используются мой аккаунт и подписки PUSH на подключённых устройствах. Согласие добровольное; его можно отозвать в настройках аккаунта в любое время. Отказ не влияет на покупки и сервисные уведомления.';
export const pushConfig = Object.freeze({
  enabled: env.PUSH_ENABLED,
  marketingEnabled: env.PUSH_MARKETING_ENABLED,
  consentVersion: CONSENT_VERSION,
  publicKey: env.VAPID_PUBLIC_KEY,
  privateKey: env.VAPID_PRIVATE_KEY,
  subject: env.VAPID_SUBJECT,
});
