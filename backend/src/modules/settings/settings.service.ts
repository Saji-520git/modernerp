import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import type { UpdateSettingsInput, UpdateModulesInput } from './settings.schema.js';

export const SETTINGS_ID = 'singleton';

export const settingsService = {

  get: async () => {
    return prisma.appSettings.upsert({
      where:  { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  },

  update: async (input: UpdateSettingsInput) => {
    const result = await prisma.appSettings.update({
      where: { id: SETTINGS_ID },
      data:  input,
    });
    logger.info({ fields: Object.keys(input) }, 'Settings updated');
    return result;
  },

  /** Super-admin only: set the optional feature module on/off map. */
  updateModules: async (input: UpdateModulesInput) => {
    const result = await prisma.appSettings.update({
      where: { id: SETTINGS_ID },
      data:  { moduleFlags: input.moduleFlags },
    });
    logger.info({ moduleFlags: input.moduleFlags }, 'Module flags updated (super-admin)');
    return result;
  },

  getCurrencySymbol: async (): Promise<string> => {
    const s = await settingsService.get();
    return s.currencySymbol;
  },
};
