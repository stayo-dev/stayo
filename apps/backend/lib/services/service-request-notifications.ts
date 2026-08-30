import { notificationService } from "./notification-service";

export interface ServiceRequestLike {
  id: string;
  type: string;
  category: string | null;
}

/** How a ticket is named in a notification — e.g. "Internet & Wi-Fi" or "Maintenance" as a fallback. */
export function ticketLabel(request: ServiceRequestLike): string {
  return request.category ?? request.type.replace(/_/g, " ");
}

/**
 * One notification, addressed to one participant (tenant or owner), about
 * one ticket — carries `metadata.requestId` so the recipient's client can
 * open that exact ticket rather than parsing an id out of text. Used for
 * both a status-update note and a pure chat message.
 */
export function notifyServiceRequestParticipant(profileId: string, request: ServiceRequestLike, message: string) {
  return notificationService.createNotification(
    profileId,
    `${ticketLabel(request)} update`,
    message,
    "service_request",
    { requestId: request.id },
  );
}
