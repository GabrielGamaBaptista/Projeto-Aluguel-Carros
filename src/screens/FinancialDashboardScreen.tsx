import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { FinancialDataProvider, useFinancialData } from '../components/financial/FinancialDataContext';
import ResumoTab from '../components/financial/ResumoTab';
import ContratosTab from '../components/financial/ContratosTab';
import CobrancasTab from '../components/financial/CobrancasTab';
import DespesasTab from '../components/financial/DespesasTab';

const TopTab = createMaterialTopTabNavigator();

// Componente interno que tem acesso ao context para chamar refresh no focus
function FinancialTabs({ navigation }: { navigation: any }) {
  const { refresh } = useFinancialData();

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => { refresh(); });
    return unsub;
  }, [navigation, refresh]);

  return (
    <TopTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#4F46E5',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarIndicatorStyle: { backgroundColor: '#4F46E5', height: 3 },
        tabBarStyle: { backgroundColor: '#fff', elevation: 2 },
        tabBarLabelStyle: { fontWeight: '700', fontSize: 12, textTransform: 'none' },
        lazy: true,
      }}
    >
      <TopTab.Screen name="Resumo" component={ResumoTab} />
      <TopTab.Screen name="Contratos" component={ContratosTab} />
      <TopTab.Screen
        name="Cobrancas"
        component={CobrancasTab}
        options={{ tabBarLabel: 'Cobranças' }}
      />
      <TopTab.Screen name="Despesas" component={DespesasTab} />
    </TopTab.Navigator>
  );
}

export default function FinancialDashboardScreen({ navigation }: { navigation: any }) {
  return (
    <FinancialDataProvider>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Financeiro</Text>
        </View>
        <FinancialTabs navigation={navigation} />
      </View>
    </FinancialDataProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: {
    backgroundColor: '#fff',
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#1F2937' },
});
