import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn().mockResolvedValue({}) }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));
vi.mock("../../config/env", () => ({
  env: {
    resend: { apiKey: "test-key", fromEmail: "no-reply@ai-argos.com", alertFromEmail: "alerts@ai-argos.com" },
    frontendUrl: "https://ai-argos.com",
  },
}));

import {
  sendAlertEmail,
  sendLoginNotificationEmail,
  sendOrganizationAddedEmail,
  sendOrganizationInvitationEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendPaymentFailedEmail,
  sendProjectShareEmail,
  sendUsageLimitReachedEmail,
  sendUsageLimitWarningEmail,
  sendWelcomeEmail,
} from "./email.service";

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({});
});

describe("sendWelcomeEmail", () => {
  it("envoie l'email de bienvenue au bon destinataire avec le bon sujet", async () => {
    await sendWelcomeEmail({ to: "user@example.com", firstName: "Jean" });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com", subject: "Bienvenue sur Argos AI" }),
    );
  });
});

describe("sendLoginNotificationEmail", () => {
  it("envoie l'email de notification de connexion", async () => {
    await sendLoginNotificationEmail({ to: "user@example.com", firstName: "Jean" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "user@example.com" }));
  });
});

describe("sendPasswordResetEmail", () => {
  it("inclut l'url de réinitialisation dans le contenu HTML", async () => {
    await sendPasswordResetEmail({ to: "user@example.com", firstName: "Jean", resetUrl: "https://ai-argos.com/reset?token=abc" });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain("https://ai-argos.com/reset?token=abc");
  });
});

describe("sendPasswordChangedEmail", () => {
  it("envoie l'email de confirmation de changement de mot de passe", async () => {
    await sendPasswordChangedEmail({ to: "user@example.com", firstName: "Jean" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendProjectShareEmail", () => {
  it("mentionne le projet et l'organisation dans le contenu", async () => {
    await sendProjectShareEmail({ to: "user@example.com", projectName: "Mon Projet", organizationName: "Ma Société" });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain("Mon Projet");
    expect(call.html).toContain("Ma Société");
  });
});

describe("sendOrganizationAddedEmail", () => {
  it("envoie l'email d'ajout à l'organisation", async () => {
    await sendOrganizationAddedEmail({ to: "user@example.com", firstName: "Jean", organizationName: "Ma Société" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendOrganizationInvitationEmail", () => {
  it("envoie l'email d'invitation", async () => {
    await sendOrganizationInvitationEmail({ to: "user@example.com", organizationName: "Ma Société" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendUsageLimitWarningEmail", () => {
  it("mentionne la ressource, l'usage et la limite", async () => {
    await sendUsageLimitWarningEmail({ to: "user@example.com", resource: "SMS", used: 8, limit: 10 });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain("SMS");
  });
});

describe("sendUsageLimitReachedEmail", () => {
  it("envoie l'email de limite atteinte", async () => {
    await sendUsageLimitReachedEmail({ to: "user@example.com", resource: "SMS", limit: 10 });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendPaymentFailedEmail", () => {
  it("envoie l'email d'échec de paiement", async () => {
    await sendPaymentFailedEmail({ to: "user@example.com", firstName: "Jean" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("sendAlertEmail", () => {
  it("utilise le badge 'ERREUR CRITIQUE' et l'adresse d'alerte pour le niveau critical", async () => {
    await sendAlertEmail({ to: "user@example.com", projectName: "Mon Projet", level: "critical", explanation: "Crash serveur" });

    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe("alerts@ai-argos.com");
    expect(call.subject).toContain("Erreur critique");
    expect(call.html).toContain("ERREUR CRITIQUE");
  });

  it("utilise le badge 'AVERTISSEMENT' pour un niveau non-critical", async () => {
    await sendAlertEmail({ to: "user@example.com", projectName: "Mon Projet", level: "warning", explanation: "Latence élevée" });

    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toContain("Avertissement");
    expect(call.html).toContain("AVERTISSEMENT");
  });
});
