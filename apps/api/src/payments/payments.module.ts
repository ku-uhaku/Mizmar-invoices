import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { ChequesService } from './cheques.service';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ChequesController, PaymentMethodsController } from './treasury.controllers';

@Module({
  // Settlement status is owned by DocumentsService; payments ask it to
  // recompute rather than writing document columns themselves.
  imports: [DocumentsModule],
  controllers: [PaymentsController, PaymentMethodsController, ChequesController],
  providers: [PaymentsService, PaymentMethodsService, ChequesService],
})
export class PaymentsModule {}
