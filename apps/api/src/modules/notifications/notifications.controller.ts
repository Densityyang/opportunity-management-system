import { Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentIdentity } from "../../common/auth.decorators";
import type { AuthIdentity } from "../../common/auth.types";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentIdentity() identity: AuthIdentity,
    @Query("unreadOnly") unreadOnly?: string,
  ) {
    return this.notifications.list(identity, unreadOnly === "true");
  }

  @Patch("read-all")
  markAllRead(@CurrentIdentity() identity: AuthIdentity) {
    return this.notifications.markAllRead(identity);
  }

  @Patch(":notificationId/read")
  markRead(
    @CurrentIdentity() identity: AuthIdentity,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notifications.markRead(identity, notificationId);
  }
}
