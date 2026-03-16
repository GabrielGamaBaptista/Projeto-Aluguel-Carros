export const EXPENSE_CATEGORIES = {
  documentacao: { label: 'Documentacao', color: '#3B82F6', icon: '📄' },
  manutencao: { label: 'Manutencao', color: '#F59E0B', icon: '🔧' },
  seguro: { label: 'Seguro', color: '#8B5CF6', icon: '🛡️' },
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

export interface SubcategoryItem {
  key: string;
  label: string;
}

export const getSubcategoryLabel = (category: string, subcategoryKey: string | null): string | null => {
  if (!subcategoryKey) return null;
  const subs = EXPENSE_SUBCATEGORIES[category as ExpenseCategory];
  if (!subs) return subcategoryKey;
  const found = subs.find(s => s.key === subcategoryKey);
  return found ? found.label : subcategoryKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

export const EXPENSE_SUBCATEGORIES: Record<ExpenseCategory, SubcategoryItem[]> = {
  documentacao: [
    { key: 'ipva', label: 'IPVA' },
    { key: 'licenciamento', label: 'Licenciamento' },
    { key: 'dpvat', label: 'DPVAT' },
    { key: 'multa', label: 'Multa' },
    { key: 'csv', label: 'CSV' },
  ],
  manutencao: [
    { key: 'troca_pneu', label: 'Troca de Pneu' },
    { key: 'troca_oleo', label: 'Troca de Oleo' },
    { key: 'lavagem', label: 'Lavagem' },
    { key: 'alinhamento', label: 'Alinhamento' },
    { key: 'balanceamento', label: 'Balanceamento' },
    { key: 'revisao', label: 'Revisao' },
    { key: 'mecanica', label: 'Mecanica' },
    { key: 'eletrica', label: 'Eletrica' },
  ],
  seguro: [],
};
