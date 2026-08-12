import { Injectable } from "@nestjs/common";
import type { AuthIdentity } from "../../common/auth.types";
import { forbidden, notFound } from "../../common/http-error";
import { PrismaService } from "../../common/prisma.service";

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: AuthIdentity, unreadOnly = false) {
    const grantId = identity.activeGrant?.id;
    return this.prisma.notification.findMany({
      where: {
        recipientUserId: identity.id,
        ...(unreadOnly ? { readAt: null } : {}),
        OR: [
          { recipientGrantId: null },
          ...(grantId ? [{ recipientGrantId: grantId }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        opportunityId: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
    });
  }

  async markRead(identity: AuthIdentity, notificationId: string) {
    const item = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!item) throw notFound("通知不存在");
    if (item.recipientUserId !== identity.id) throw forbidden();
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: item.readAt ?? new Date() },
    });
    return { read: true };
  }

  async markAllRead(identity: AuthIdentity) {
    const grantId = identity.activeGrant?.id;
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientUserId: identity.id,
        readAt: null,
        OR: [
          { recipientGrantId: null },
          ...(grantId ? [{ recipientGrantId: grantId }] : []),
        ],
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
