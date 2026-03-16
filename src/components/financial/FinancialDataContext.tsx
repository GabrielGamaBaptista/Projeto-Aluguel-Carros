import React, { createContext, useState, useCallback, useContext } from 'react';
import paymentService from '../../services/paymentService';
import expenseService from '../../services/expenseService';
import { auth } from '../../config/firebase';

interface FinancialDataContextType {
  charges: any[];
  contracts: any[];
  expenses: any[];
  customCategories: any[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  selectedCar: string;
  setSelectedCar: (car: string) => void;
  selectedStatus: string;
  setSelectedStatus: (status: string) => void;
  refresh: () => Promise<void>;
  getNextPendingForContract: (contractId: string) => any | null;
}

const FinancialDataContext = createContext<FinancialDataContextType>({
  charges: [],
  contracts: [],
  expenses: [],
  customCategories: [],
  loading: true,
  refreshing: false,
  error: null,
  selectedCar: 'TODOS',
  setSelectedCar: () => {},
  selectedStatus: 'TODOS',
  setSelectedStatus: () => {},
  refresh: async () => {},
  getNextPendingForContract: () => null,
});

export const useFinancialData = () => useContext(FinancialDataContext);

export const FinancialDataProvider = ({ children }: { children: React.ReactNode }) => {
  const [charges, setCharges] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [customCategories, setCustomCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCar, setSelectedCar] = useState<string>('TODOS');
  const [selectedStatus, setSelectedStatus] = useState<string>('TODOS');

  const getNextPendingForContract = useCallback((contractId: string) => {
    return charges
      .filter(c => c.contractId === contractId && ['PENDING', 'OVERDUE'].includes(c.status))
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0] || null;
  }, [charges]);

  const refresh = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const uid = auth().currentUser?.uid;
      const [chargesData, contractsData, expensesResult, customCatsResult] = await Promise.all([
        paymentService.getAllChargesForLandlord(),
        paymentService.getAllContractsForLandlord(),
        uid ? expenseService.getExpensesByLandlord(uid) : { success: true, data: [] },
        uid ? expenseService.getCustomCategories(uid) : { success: true, data: [] },
      ]);
      setCharges(chargesData);
      setContracts(contractsData);
      if (expensesResult.success && expensesResult.data) setExpenses(expensesResult.data);
      if (customCatsResult.success && customCatsResult.data) setCustomCategories(customCatsResult.data);
    } catch (err: any) {
      console.error('Error loading financial data:', err);
      setError(err?.message || 'Falha ao carregar dados financeiros.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  return (
    <FinancialDataContext.Provider value={{
      charges, contracts, expenses, customCategories,
      loading, refreshing, error,
      selectedCar, setSelectedCar,
      selectedStatus, setSelectedStatus,
      refresh, getNextPendingForContract,
    }}>
      {children}
    </FinancialDataContext.Provider>
  );
};

export default FinancialDataContext;
