import React, { createContext, useState, useCallback, useContext } from 'react';
import paymentService from '../../services/paymentService';

interface FinancialDataContextType {
  charges: any[];
  contracts: any[];
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
      const [chargesData, contractsData] = await Promise.all([
        paymentService.getAllChargesForLandlord(),
        paymentService.getAllContractsForLandlord(),
      ]);
      setCharges(chargesData);
      setContracts(contractsData);
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
      charges, contracts, loading, refreshing, error,
      selectedCar, setSelectedCar,
      selectedStatus, setSelectedStatus,
      refresh, getNextPendingForContract,
    }}>
      {children}
    </FinancialDataContext.Provider>
  );
};

export default FinancialDataContext;
