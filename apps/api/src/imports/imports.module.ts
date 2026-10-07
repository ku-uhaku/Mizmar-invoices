import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [CatalogModule, ContactsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
