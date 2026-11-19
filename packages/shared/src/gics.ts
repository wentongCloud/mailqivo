/** Stable English storage names and legacy localized values. Custom industries retain their own spelling. */
export const GICS_INDUSTRIES = [
  { key: "electronicComponents", value: "Electronic Components", legacy: "电子元件" },
  { key: "technologyDistributors", value: "Technology Distributors", legacy: "技术产品经销商" },
  { key: "semiconductors", value: "Semiconductors", legacy: "半导体产品" },
  { key: "industrialMachinery", value: "Industrial Machinery", legacy: "工业机械" },
  { key: "itServices", value: "IT Services", legacy: "信息技术服务" },
  { key: "specialtyChemicals", value: "Specialty Chemicals", legacy: "特种化学制品" },
  { key: "distributors", value: "Distributors", legacy: "分销商" },
  { key: "electronicEquipment", value: "Electronic Equipment & Instruments", legacy: "电子设备与仪器" },
  { key: "semiconductorEquipment", value: "Semiconductor Equipment", legacy: "半导体设备" },
  { key: "electricalComponents", value: "Electrical Components & Equipment", legacy: "电气部件与设备" },
  { key: "autoParts", value: "Auto Parts & Equipment", legacy: "汽车零配件" },
  { key: "communicationsEquipment", value: "Communications Equipment", legacy: "通信设备" },
  { key: "diversifiedSupport", value: "Diversified Support Services", legacy: "综合支持服务" },
  { key: "packagedFoods", value: "Packaged Foods & Meats", legacy: "包装食品与肉类" },
  { key: "householdAppliances", value: "Household Appliances", legacy: "家用电器" },
  { key: "electronicManufacturing", value: "Electronic Manufacturing Services", legacy: "电子制造服务" },
  { key: "pharmaceuticals", value: "Pharmaceuticals", legacy: "制药" },
  { key: "agriculturalProducts", value: "Agricultural Products", legacy: "农产品" },
  { key: "diversifiedFinancials", value: "Diversified Financial Services", legacy: "多元金融服务" },
  { key: "paperPackaging", value: "Paper Packaging", legacy: "纸材料包装" },
] as const;

const byName = new Map<string, (typeof GICS_INDUSTRIES)[number]>();
for (const industry of GICS_INDUSTRIES) {
  byName.set(industry.value, industry);
  byName.set(industry.legacy, industry);
}

export function canonicalIndustry(name: string): string {
  return byName.get(name.trim())?.value ?? name.trim();
}

export function industryAliases(name: string): string[] {
  const industry = byName.get(name.trim());
  return industry ? [industry.value, industry.legacy] : [name.trim()];
}
