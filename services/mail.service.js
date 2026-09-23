import { env } from "../config/env.js";
import { mailTransporter } from "../config/mail.js";

function createPasswordResetUrl(token) {
  const url = new URL("/login.html", env.APP_URL);
  url.searchParams.set("view", "reset");
  url.hash = new URLSearchParams({ token }).toString();

  return url.toString();
}

export async function sendPasswordResetEmail({
  to,
  token,
}) {
  const resetUrl = createPasswordResetUrl(token);

  await mailTransporter.sendMail({
    from: {
      name: env.APP_NAME,
      address: env.SMTP_USER,
    },
    to,
    subject: `Восстановление пароля — ${env.APP_NAME}`,
    text: [
      `Для аккаунта ${env.APP_NAME} был запрошен сброс пароля.`,
      "",
      `Создать новый пароль: ${resetUrl}`,
      "",
      "Ссылка действует 30 минут и может быть использована только один раз.",
      "Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f1f1f">
        <h2 style="margin:0 0 16px">Восстановление пароля</h2>
        <p>Для аккаунта «${env.APP_NAME}» был запрошен сброс пароля.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1f1f1f;color:#ffffff;text-decoration:none">
            Создать новый пароль
          </a>
        </p>
        <p>Ссылка действует 30 минут и может быть использована только один раз.</p>
        <p>Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>
      </div>
    `,
  });
}
