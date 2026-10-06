import { prisma } from "../../lib/prisma";
import type { GroupedLog } from "./log-grouper.service";
import { triageLog } from "./log-triage.service";
import { listProjectPhoneRecipients, listProjectRecipients } from "../organization/project-access.service";
import { sendAlertEmail } from "../notifications/email.service";
import { sendAlertSms } from "../notifications/sms.service";
import { getSubscriptionForProject, tryConsumeSmsQuota } from "../billing/subscription.service";

// Fenêtre de recherche d'un doublon avant insertion — un fournisseur (Railway, Render) rejoue
// parfois ses derniers logs à chaque (re)connexion (voir startLogStreamForProject), typiquement
// juste après un redémarrage du backend. 24h couvre largement ce cas sans risquer d'ignorer un
// vrai nouveau log qui coïnciderait par hasard avec un ancien message identique bien plus tard.
const DUPLICATE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// Point d'entrée commun à tous les fournisseurs d'hébergement (Railway, Render, ...) une fois
// qu'un log a été classé/groupé : persistance, triage IA, création d'alerte et notifications.
// Partagé pour ne jamais dupliquer ce flux à chaque nouveau fournisseur ajouté.
export async function persistGroupedLog(projectId: string, source: string, log: GroupedLog) {
  const isDuplicate = await prisma.logEntry.findFirst({
    where: {
      projectId,
      rawMessage: log.rawMessage,
      externalTimestamp: log.externalTimestamp,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_LOOKBACK_MS) },
    },
    select: { id: true },
  });

  if (isDuplicate) {
    return;
  }

  const needsTriage = log.category === "critical" || log.category === "warning";

  const entry = await prisma.logEntry.create({
    data: {
      projectId,
      rawMessage: log.rawMessage,
      level: log.level,
      category: log.category,
      source,
      externalTimestamp: log.externalTimestamp,
      triageStatus: needsTriage ? "pending" : "none",
    },
  });

  if (needsTriage) {
    triageIncidentIfNeeded(projectId, entry.id, log).catch(async (err) => {
      console.error(`Erreur de triage IA du log ${entry.id} (projet ${projectId}) :`, err);

      await prisma.logEntry
        .update({ where: { id: entry.id }, data: { triageStatus: "done" } })
        .catch(() => {});
    });
  }
}

async function triageIncidentIfNeeded(projectId: string, logEntryId: string, log: GroupedLog) {
  await prisma.logEntry.update({ where: { id: logEntryId }, data: { triageStatus: "checking" } });

  const triage = await triageLog({ level: log.level, category: log.category, message: log.rawMessage });
  const wasReclassified = triage.finalCategory !== log.category;

  await prisma.logEntry.update({
    where: { id: logEntryId },
    data: {
      aiSummary: triage.explanation,
      category: triage.finalCategory,
      originalCategory: wasReclassified ? log.category : null,
      triageStatus: "done",
    },
  });

  if (triage.isRealIssue) {
    const alert = await prisma.alert.create({
      data: {
        logEntryId,
        explanation: triage.explanation,
        fixLocation: triage.fixLocation,
        severityScore: triage.severityScore,
      },
    });

    notifyProjectRecipients(alert.id, projectId, triage.finalCategory, triage.explanation, triage.severityScore).catch(
      (err) => console.error(`Erreur lors de l'envoi des emails d'alerte pour le projet ${projectId} :`, err)
    );
  }
}

async function notifyProjectRecipients(
  alertId: string,
  projectId: string,
  level: string,
  explanation: string,
  severityScore: number
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, userId: true, organizationId: true, user: { select: { email: true } } },
  });
  if (!project) return;

  const [recipients, phoneRecipients] = await Promise.all([
    listProjectRecipients(projectId),
    listProjectPhoneRecipients(projectId),
  ]);

  const emailNotifications = recipients.map((to) =>
    sendAlertEmail({ to, projectName: project.name, level, explanation }).catch((err) =>
      console.error(`Erreur lors de l'envoi de l'email d'alerte à ${to} :`, err)
    )
  );

  // Le quota SMS se consomme une fois par alerte (pas une fois par destinataire) : soit
  // tous les destinataires reçoivent le SMS, soit aucun, pour ne pas épuiser le quota plus
  // vite sur un projet à plusieurs membres.
  let smsNotifications: Promise<void>[] = [];
  let smsAttempted = false;
  if (phoneRecipients.length > 0) {
    const subscription = await getSubscriptionForProject(project);
    const smsAllowed = subscription ? await tryConsumeSmsQuota(subscription, project.user.email) : true;

    if (smsAllowed) {
      smsAttempted = true;
      smsNotifications = phoneRecipients.map((to) =>
        sendAlertSms({ to, projectName: project.name, severityScore }).catch((err) =>
          console.error(`Erreur lors de l'envoi du SMS d'alerte à ${to} :`, err)
        )
      );
    }
  }

  await Promise.all([...emailNotifications, ...smsNotifications]);

  await prisma.alert
    .update({
      where: { id: alertId },
      data: { emailSent: recipients.length > 0, smsSent: smsAttempted },
    })
    .catch((err) => console.error(`Erreur lors de la mise à jour du statut de notification de l'alerte ${alertId} :`, err));
}
