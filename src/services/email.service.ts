import { Resend } from "resend";
import { env } from "../config/env";

const resend = new Resend(env.resend.apiKey);

async function send(params: { to: string; subject: string; html: string }) {
  await resend.emails.send({
    from: env.resend.fromEmail,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}

const BRAND = {
  bg: "#0B1120",
  cardBg: "#FFFFFF",
  accent: "#2563EB",
  accentSoft: "#EFF6FF",
  ink: "#0F172A",
  inkMuted: "#64748B",
  border: "#E2E8F0",
  critical: "#F87171",
  criticalSoft: "#FEF2F2",
  warning: "#FBBF24",
  warningSoft: "#FFFBEB",
};

function layout(params: { preheader: string; badge?: { label: string; color: string; bg: string }; body: string }) {
  const { preheader, badge, body } = params;

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Argos AI</title>
  </head>
  <body style="margin:0; padding:0; background-color:${BRAND.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <!-- Texte d'aperçu, invisible, affiché par les clients mail à côté de l'objet -->
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.bg};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px; max-width:100%;">
            <!-- En-tête produit -->
            <tr>
              <td style="padding:0 8px 24px; text-align:center;">
                <span style="font-size:18px; font-weight:700; letter-spacing:-0.01em; color:#FFFFFF;">Argos AI</span>
              </td>
            </tr>

            <!-- Carte -->
            <tr>
              <td style="background-color:${BRAND.cardBg}; border-radius:12px; padding:32px; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                ${
                  badge
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
                        <tr>
                          <td style="background-color:${badge.bg}; color:${badge.color}; font-size:12px; font-weight:600; padding:4px 10px; border-radius:999px;">${badge.label}</td>
                        </tr>
                      </table>`
                    : ""
                }
                ${body}
              </td>
            </tr>

            <!-- Pied de page -->
            <tr>
              <td style="padding:24px 8px 0; text-align:center;">
                <p style="margin:0; font-size:12px; line-height:18px; color:#94A3B8;">
                  Argos AI — surveillance de vos projets et de leurs logs.<br />
                  Vous recevez cet email suite à une action sur votre compte.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const TEXT = `margin:0 0 16px; font-size:15px; line-height:24px; color:${BRAND.ink};`;
const TEXT_LAST = `margin:0; font-size:15px; line-height:24px; color:${BRAND.ink};`;
const TITLE = `margin:0 0 16px; font-size:20px; line-height:28px; font-weight:700; color:${BRAND.ink};`;

function button(params: { href: string; label: string }) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
      <tr>
        <td style="background-color:${BRAND.accent}; border-radius:8px;">
          <a href="${params.href}" style="display:inline-block; padding:12px 24px; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none;">${params.label}</a>
        </td>
      </tr>
    </table>`;
}

export function sendWelcomeEmail(params: { to: string; firstName: string }) {
  return send({
    to: params.to,
    subject: "Bienvenue sur Argos AI",
    html: layout({
      preheader: "Votre compte Argos AI a bien été créé.",
      body: `
        <p style="${TITLE}">Bienvenue, ${params.firstName} 👋</p>
        <p style="${TEXT}">Votre compte Argos AI a bien été créé.</p>
        <p style="${TEXT_LAST}">Vous pouvez dès maintenant connecter un projet pour commencer à surveiller ses logs.</p>
        ${button({ href: env.frontendUrl, label: "Accéder à mon tableau de bord" })}
      `,
    }),
  });
}

export function sendLoginNotificationEmail(params: { to: string; firstName: string }) {
  return send({
    to: params.to,
    subject: "Nouvelle connexion à votre compte Argos AI",
    html: layout({
      preheader: "Une connexion vient d'avoir lieu sur votre compte.",
      body: `
        <p style="${TITLE}">Nouvelle connexion</p>
        <p style="${TEXT}">Bonjour ${params.firstName},</p>
        <p style="${TEXT_LAST}">Une connexion vient d'avoir lieu sur votre compte Argos AI. Si ce n'est pas vous, changez votre mot de passe dès que possible.</p>
      `,
    }),
  });
}

export function sendProjectShareEmail(params: { to: string; projectName: string; organizationName: string }) {
  return send({
    to: params.to,
    subject: `${params.organizationName} vous a donné accès à un projet sur Argos AI`,
    html: layout({
      preheader: `${params.organizationName} vous a donné accès au projet ${params.projectName}.`,
      body: `
        <p style="${TITLE}">Accès à un projet</p>
        <p style="${TEXT}"><strong>${params.organizationName}</strong> vous a donné accès au projet <strong>${params.projectName}</strong> sur Argos AI.</p>
        <p style="${TEXT_LAST}">Si vous n'avez pas encore de compte, il vous suffit de vous inscrire avec cette adresse email pour y accéder automatiquement.</p>
        ${button({ href: env.frontendUrl, label: "Accéder au projet" })}
      `,
    }),
  });
}

export function sendOrganizationAddedEmail(params: { to: string; firstName: string; organizationName: string }) {
  return send({
    to: params.to,
    subject: `Vous avez été ajouté à ${params.organizationName} sur Argos AI`,
    html: layout({
      preheader: `Vous faites maintenant partie de ${params.organizationName} sur Argos AI.`,
      body: `
        <p style="${TITLE}">Nouvelle organisation</p>
        <p style="${TEXT}">Bonjour ${params.firstName},</p>
        <p style="${TEXT_LAST}">Vous avez été ajouté à l'organisation <strong>${params.organizationName}</strong> sur Argos AI. Vous avez désormais accès à ses projets.</p>
        ${button({ href: env.frontendUrl, label: "Accéder à mon tableau de bord" })}
      `,
    }),
  });
}

export function sendOrganizationInvitationEmail(params: { to: string; organizationName: string }) {
  return send({
    to: params.to,
    subject: `${params.organizationName} vous invite sur Argos AI`,
    html: layout({
      preheader: `${params.organizationName} vous invite à rejoindre son organisation sur Argos AI.`,
      body: `
        <p style="${TITLE}">Invitation à rejoindre une organisation</p>
        <p style="${TEXT}"><strong>${params.organizationName}</strong> vous invite à rejoindre son organisation sur Argos AI.</p>
        <p style="${TEXT_LAST}">Pour l'accepter, il vous suffit de créer un compte avec cette adresse email : vous serez automatiquement rattaché à l'organisation.</p>
        ${button({ href: env.frontendUrl, label: "Créer mon compte" })}
      `,
    }),
  });
}

export function sendUsageLimitWarningEmail(params: { to: string; resource: string; used: number; limit: number }) {
  return send({
    to: params.to,
    subject: `Vous approchez de votre quota ${params.resource} sur Argos AI`,
    html: layout({
      preheader: `${params.used} sur ${params.limit} ${params.resource} utilisés ce mois-ci.`,
      badge: { label: "QUOTA À 80%", color: "#B45309", bg: BRAND.warningSoft },
      body: `
        <p style="${TITLE}">Vous approchez de votre quota</p>
        <p style="${TEXT}">Vous avez utilisé <strong>${params.used} sur ${params.limit}</strong> ${params.resource} inclus dans votre abonnement ce mois-ci.</p>
        <p style="${TEXT_LAST}">Passé cette limite, ${params.resource} ne seront plus envoyés jusqu'au renouvellement de votre période — les autres notifications (email) continuent normalement.</p>
        ${button({ href: `${env.frontendUrl}/dashboard/organizations/billing`, label: "Voir mon abonnement" })}
      `,
    }),
  });
}

export function sendUsageLimitReachedEmail(params: { to: string; resource: string; limit: number }) {
  return send({
    to: params.to,
    subject: `Quota ${params.resource} atteint sur Argos AI`,
    html: layout({
      preheader: `Votre quota de ${params.limit} ${params.resource} pour ce mois est atteint.`,
      badge: { label: "QUOTA ATTEINT", color: BRAND.critical, bg: BRAND.criticalSoft },
      body: `
        <p style="${TITLE}">Quota atteint</p>
        <p style="${TEXT}">Votre quota de <strong>${params.limit} ${params.resource}</strong> inclus dans votre abonnement est atteint pour ce mois-ci.</p>
        <p style="${TEXT_LAST}">${params.resource} supplémentaires ne seront plus envoyés jusqu'au renouvellement de votre période — les autres notifications (email) continuent normalement.</p>
        ${button({ href: `${env.frontendUrl}/dashboard/organizations/billing`, label: "Voir mon abonnement" })}
      `,
    }),
  });
}

export function sendAlertEmail(params: {
  to: string;
  projectName: string;
  level: string;
  explanation: string;
}) {
  const isCritical = params.level === "critical";
  const levelLabel = isCritical ? "Erreur critique" : "Avertissement";
  const badge = isCritical
    ? { label: "ERREUR CRITIQUE", color: BRAND.critical, bg: BRAND.criticalSoft }
    : { label: "AVERTISSEMENT", color: "#B45309", bg: BRAND.warningSoft };

  return send({
    to: params.to,
    subject: `[${params.projectName}] ${levelLabel} détecté`,
    html: layout({
      preheader: `${levelLabel} détecté sur ${params.projectName} : ${params.explanation}`,
      badge,
      body: `
        <p style="${TITLE}">${levelLabel} détecté</p>
        <p style="${TEXT}">Projet concerné : <strong>${params.projectName}</strong></p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8FAFC; border-left:3px solid ${isCritical ? BRAND.critical : BRAND.warning}; border-radius:4px; margin:0 0 20px;">
          <tr>
            <td style="padding:14px 16px;">
              <p style="margin:0; font-size:14px; line-height:22px; color:${BRAND.ink};">${params.explanation}</p>
            </td>
          </tr>
        </table>
        <p style="${TEXT_LAST}">Connectez-vous à Argos AI pour voir le détail de cette alerte.</p>
        ${button({ href: env.frontendUrl, label: "Voir l'alerte" })}
      `,
    }),
  });
}
