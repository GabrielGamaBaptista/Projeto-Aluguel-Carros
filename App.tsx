// App.tsx
import React, { useState, useEffect, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClipboardList, Megaphone, BarChart3, User } from 'lucide-react-native';
import { MdiCar, MdiCash } from './src/components/icons/MdiIcons';
import { authService } from './src/services/authService';
import { notificationService } from './src/services/notificationService';
import { permissionService } from './src/services/permissionService';
import PermissionsScreen from './src/screens/PermissionsScreen';

import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import EmailVerificationScreen from './src/screens/EmailVerificationScreen';
import GoogleCompleteProfileScreen from './src/screens/GoogleCompleteProfileScreen';
import HomeScreen from './src/screens/HomeScreen';
import TasksScreen from './src/screens/TasksScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AddCarScreen from './src/screens/AddCarScreen';
import TaskDetailsScreen from './src/screens/TaskDetailsScreen';
import CarDetailsScreen from './src/screens/CarDetailsScreen';
import EditCarScreen from './src/screens/EditCarScreen';
import AssignTenantScreen from './src/screens/AssignTenantScreen';
import TenantDetailsScreen from './src/screens/TenantDetailsScreen';
import MuralManagerScreen from './src/screens/MuralManagerScreen';
import PaymentContractScreen from './src/screens/PaymentContractScreen';
import ChargesScreen from './src/screens/ChargesScreen';
import TenantPaymentsScreen from './src/screens/TenantPaymentsScreen';
import PaymentDetailsScreen from './src/screens/PaymentDetailsScreen';
import FinancialDashboardScreen from './src/screens/FinancialDashboardScreen';
import ContractDetailsScreen from './src/screens/ContractDetailsScreen';
import VehicleHistoryScreen from './src/screens/VehicleHistoryScreen';
import AddExpenseScreen from './src/screens/AddExpenseScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// ===== CONFIGURAR GOOGLE SIGN-IN =====
// Substitua pelo seu Web Client ID do Firebase Console
const GOOGLE_WEB_CLIENT_ID = '254869962668-nj7m0u07ht72snebifnrr60lsqn3bapg.apps.googleusercontent.com';
authService.configureGoogleSignIn(GOOGLE_WEB_CLIENT_ID);

function MainTabs({ userRole }) {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator screenOptions={{
      tabBarActiveTintColor: '#4F46E5', tabBarInactiveTintColor: '#9CA3AF', headerShown: false,
      tabBarStyle: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingBottom: insets.bottom + 4, paddingTop: 8, height: 60 + insets.bottom },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
    }}>
      <Tab.Screen name="Home" component={HomeScreen}
        options={{ tabBarLabel: 'Carros', tabBarIcon: ({ color }) => <MdiCar size={22} color={color} /> }} />
      <Tab.Screen name="Tasks" component={TasksScreen}
        options={{ tabBarLabel: 'Tarefas', tabBarIcon: ({ color }) => <ClipboardList size={22} color={color} /> }} />
      {userRole === 'locatario' && (
        <Tab.Screen name="TenantPayments" component={TenantPaymentsScreen}
          options={{ tabBarLabel: 'Pagamentos', tabBarIcon: ({ color }) => <MdiCash size={22} color={color} /> }} />
      )}
      {userRole === 'locador' && (
        <Tab.Screen name="Mural" component={MuralManagerScreen}
          options={{ tabBarLabel: 'Mural', tabBarIcon: ({ color }) => <Megaphone size={22} color={color} /> }} />
      )}
      {userRole === 'locador' && (
        <Tab.Screen name="Financial" component={FinancialDashboardScreen}
          options={{ tabBarLabel: 'Financeiro', tabBarIcon: ({ color }) => <BarChart3 size={22} color={color} /> }} />
      )}
      <Tab.Screen name="Profile" component={ProfileScreen}
        options={{ tabBarLabel: 'Perfil', tabBarIcon: ({ color }) => <User size={22} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const userUidRef = useRef(null); // ref para uso no handler de logout (evita stale closure)
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);
  const [needsGoogleProfile, setNeedsGoogleProfile] = useState(false);
  const [needsPermissions, setNeedsPermissions] = useState(false);

  const loadProfile = async (currentUser) => {
    const result = await authService.getCurrentUserProfile(currentUser.uid);
    if (result.success) {
      userUidRef.current = currentUser.uid;
      setUser(currentUser);
      setUserProfile(result.data);
      setNeedsGoogleProfile(false);
      const isGoogle = result.data.authProvider === 'google';
      const verified = currentUser.emailVerified || isGoogle || result.data.emailVerified;
      setEmailVerified(verified);
      if (verified) {
        const seen = await permissionService.hasRequestedPermissions();
        if (seen) {
          // Permissoes ja concedidas — inicializar notificacoes agora
          await notificationService.initialize(currentUser.uid);
        }
        setNeedsPermissions(!seen);
      }
    } else {
      setUser(currentUser);
      setUserProfile(null);
      setNeedsGoogleProfile(true);
      setEmailVerified(true);
    }
  };

  useEffect(() => {
    const unsub = authService.onAuthStateChanged(async (u) => {
      if (u) await loadProfile(u);
      else {
        if (userUidRef.current) await notificationService.removeToken(userUidRef.current);
        userUidRef.current = null;
        setUser(null); setUserProfile(null); setEmailVerified(false); setNeedsGoogleProfile(false); setNeedsPermissions(false);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return (
    <View style={styles.loading}><ActivityIndicator size="large" color="#4F46E5" /><Text style={styles.loadingText}>Carregando...</Text></View>
  );

  return (
    <SafeAreaProvider>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: true, headerTitle: '', headerBackTitle: 'Voltar' }} />
          </>
        ) : needsGoogleProfile ? (
          <Stack.Screen name="GoogleCompleteProfile">
            {() => <GoogleCompleteProfileScreen onComplete={async () => { const u = authService.getCurrentUser(); if (u) await loadProfile(u); }} />}
          </Stack.Screen>
        ) : !emailVerified ? (
          <Stack.Screen name="EmailVerification">
            {() => <EmailVerificationScreen onVerified={async () => {
              setEmailVerified(true);
              const u = authService.getCurrentUser();
              if (u) {
                const seen = await permissionService.hasRequestedPermissions();
                if (seen) await notificationService.initialize(u.uid);
                setNeedsPermissions(!seen);
              }
            }} />}
          </Stack.Screen>
        ) : needsPermissions ? (
          <Stack.Screen name="Permissions">
            {() => <PermissionsScreen onComplete={async () => {
              await notificationService.initialize(user.uid);
              setNeedsPermissions(false);
            }} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="MainTabs">{(props) => <MainTabs {...props} userRole={userProfile?.role} />}</Stack.Screen>
            <Stack.Screen name="CarDetails" component={CarDetailsScreen} options={{ headerShown: true, headerTitle: 'Detalhes do Carro', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="EditCar" component={EditCarScreen} options={{ headerShown: true, headerTitle: 'Editar Carro', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="AssignTenant" component={AssignTenantScreen} options={{ headerShown: true, headerTitle: 'Atribuir Locatario', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="TaskDetails" component={TaskDetailsScreen} options={{ headerShown: true, headerTitle: 'Detalhes da Tarefa', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="TenantDetails" component={TenantDetailsScreen} options={{ headerShown: true, headerTitle: 'Dados do Locatario', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="AddCar" component={AddCarScreen} options={{ headerShown: true, headerTitle: 'Adicionar Carro', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="ContractDetails" component={ContractDetailsScreen} options={{ headerShown: true, headerTitle: 'Detalhes do Contrato', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="PaymentContract" component={PaymentContractScreen} options={{ headerShown: true, headerTitle: 'Configurar Pagamento', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="Charges" component={ChargesScreen} options={{ headerShown: true, headerTitle: 'Cobranças', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="PaymentDetails" component={PaymentDetailsScreen} options={{ headerShown: true, headerTitle: 'Detalhes do Pagamento', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="VehicleHistory" component={VehicleHistoryScreen} options={{ headerShown: true, headerTitle: 'Historico do Veiculo', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
            <Stack.Screen name="AddExpense" component={AddExpenseScreen} options={{ headerShown: true, headerTitle: 'Lancar Despesa', headerBackTitle: 'Voltar', headerTintColor: '#4F46E5' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#6B7280' },
});
