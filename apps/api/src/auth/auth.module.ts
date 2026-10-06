import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  // Global so the app-wide AuthGuard, declared in AppModule, can inject it.
  // Secrets are passed per sign/verify call rather than baked in here, because
  // access and refresh tokens use different ones.
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
