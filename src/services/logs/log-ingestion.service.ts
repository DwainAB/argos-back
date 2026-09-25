import { prisma } from "../../lib/prisma";
import type { GroupedLog } from "./log-grouper.service";
import { triageLog } from "./log-triage.service";
import { listProjectPhoneRecipients, listProjectRecipients } from "../organization/project-access.service";
import { sendAlertEmail } from "../notifications/email.service";
import { sendAlertSms } from "../notifications/sms.service";
import { getSubscriptionForProject, tryConsumeSmsQuota } from "../billing/subscription.service";

// Point d'entrée commun à tous les fournisseurs d'hébergement (Railway, Render, ...) une fois
// qu'un log a été classé/groupé : persistance, triage IA, création d'alerte et notifications.
// Partagé pour ne jamais dupliquer ce flux à chaque nouveau fournisseur ajouté.
export async function persistGroupedLog(projectId: string, source: string, log: GroupedLog) {
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
    await prisma.alert.create({
      data: { logEntryId, explanation: triage.explanation, fixLocation: triage.fixLocation },
    });

    notifyProjectRecipients(projectId, triage.finalCategory, triage.explanation).catch((err) =>
      console.error(`Erreur lors de l'envoi des emails d'alerte pour le projet ${projectId} :`, err)
    );
  }
}

async function notifyProjectRecipients(projectId: string, level: string, explanation: string) {
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
  if (phoneRecipients.length > 0) {
    const subscription = await getSubscriptionForProject(project);
    const smsAllowed = subscription ? await tryConsumeSmsQuota(subscription, project.user.email) : true;

    if (smsAllowed) {
      smsNotifications = phoneRecipients.map((to) =>
        sendAlertSms({ to, projectName: project.name, level, explanation }).catch((err) =>
          console.error(`Erreur lors de l'envoi du SMS d'alerte à ${to} :`, err)
        )
      );
    }
  }

  await Promise.all([...emailNotifications, ...smsNotifications]);
}
