import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/auth.decorators";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "./common/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async getHealth(): Promise<{
    status: string;
    database: string;
    time: string;
  }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "ok", time: new Date().toISOString() };
  }
}
