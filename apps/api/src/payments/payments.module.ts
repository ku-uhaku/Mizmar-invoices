import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  // Settlement status is owned by DocumentsService; payments ask it to
  // recompute rather than writing document columns themselves.
  imports: [DocumentsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
