import type { Command } from '../../src/shared/commands';

export const BuildDistrictFor = (colony: number, region: number, district: number): Command => ({
  type: 'BuildDistrict',
  colony,
  region,
  district,
});

export const BuildSpaceportFor = (colony: number, region: number): Command => ({
  type: 'BuildSpaceport',
  colony,
  region,
});

export const StanceFor = (colony: number, stance: number): Command => ({
  type: 'SetColonyStance',
  colony,
  stance,
});

export const ChooseTech = (tech: number): Command => ({ type: 'ChooseTech', tech });
