import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { FileText, Wrench, Shield, ChevronDown } from 'lucide-react-native';
import { EXPENSE_CATEGORIES, EXPENSE_SUBCATEGORIES } from '../constants/expenseCategories';
import expenseService from '../services/expenseService';

type Category = 'documentacao' | 'manutencao' | 'seguro';

const CATEGORY_ICONS: Record<string, React.ComponentType<any>> = {
  FileText, Wrench, Shield,
};

const formatDateInput = (text: string) => {
  const clean = text.replace(/\D/g, '');
  if (clean.length <= 2) return clean;
  if (clean.length <= 4) return clean.slice(0, 2) + '/' + clean.slice(2);
  return clean.slice(0, 2) + '/' + clean.slice(2, 4) + '/' + clean.slice(4, 8);
};

const parseDateToISO = (text: string): string | null => {
  if (!text || text.length < 10) return null;
  const parts = text.split('/');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year) || year < 2000) return null;
  const dateObj = new Date(year, month - 1, day);
  if (dateObj.getFullYear() !== year || dateObj.getMonth() !== month - 1 || dateObj.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const isoToDisplay = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const AddExpenseScreen = ({ route, navigation }: any) => {
  const { carId, carInfo, tenantId, landlordId, expense } = route.params;
  const isEditing = !!expense;

  const [category, setCategory] = useState<Category | null>(expense?.category || null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [subcategory, setSubcategory] = useState<string | null>(expense?.subcategory || null);
  const [showSubcategoryPicker, setShowSubcategoryPicker] = useState(false);
  const [customSubName, setCustomSubName] = useState('');
  const [maintenanceDescription, setMaintenanceDescription] = useState(expense?.maintenanceDescription || '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [dateText, setDateText] = useState(() => {
    if (expense?.date) return isoToDisplay(expense.date);
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  });
  const [splitWithTenant, setSplitWithTenant] = useState(expense?.splitWithTenant ?? false);
  const [description, setDescription] = useState(expense?.description || '');
  const [saving, setSaving] = useState(false);
  const [customCategories, setCustomCategories] = useState<any[]>([]);
  const isInitialMount = useRef(true);

  useEffect(() => {
    loadCustomCategories();
  }, []);

  const loadCustomCategories = async () => {
    const result = await expenseService.getCustomCategories(landlordId);
    if (result.success && result.data) setCustomCategories(result.data);
  };

  const getSubcategories = useMemo(() => {
    if (!category || category === 'seguro') return [];
    const base = EXPENSE_SUBCATEGORIES[category] || [];
    const custom = customCategories.filter(c => c.parentCategory === category);
    const merged = [...base, ...custom.map(c => ({ key: c.key, label: c.name }))];
    merged.push({ key: 'outros', label: 'Outros' });
    return merged;
  }, [category, customCategories]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setSubcategory(null);
    setCustomSubName('');
    setShowSubcategoryPicker(false);
  }, [category]);

  const handleSave = async () => {
    if (!category) {
      Alert.alert('Erro', 'Selecione uma categoria.');
      return;
    }

    const parsedAmount = parseFloat(amount.replace(/\./g, '').replace(',', '.'));
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Erro', 'Informe um valor valido.');
      return;
    }

    const isoDate = parseDateToISO(dateText);
    if (!isoDate) {
      Alert.alert('Erro', 'Data invalida. Use o formato DD/MM/AAAA.');
      return;
    }

    if (category !== 'seguro' && !subcategory) {
      Alert.alert('Erro', 'Selecione uma subcategoria.');
      return;
    }

    if (subcategory === 'outros' && !customSubName.trim()) {
      Alert.alert('Erro', 'Informe o nome da subcategoria.');
      return;
    }

    setSaving(true);

    let finalSubcategory = subcategory;
    if (subcategory === 'outros' && customSubName.trim()) {
      const key = customSubName.trim().toLowerCase().replace(/\s+/g, '_');
      const alreadyExists = customCategories.some(
        c => c.parentCategory === category && c.key === key
      );
      if (!alreadyExists) {
        await expenseService.createCustomCategory({
          parentCategory: category,
          name: customSubName.trim(),
          key,
        });
      }
      finalSubcategory = key;
    }

    const expenseData: any = {
      carId,
      tenantId: tenantId || null,
      category,
      subcategory: finalSubcategory || null,
      maintenanceDescription: category === 'manutencao' ? (maintenanceDescription.trim() || null) : null,
      amount: parsedAmount,
      splitWithTenant,
      date: isoDate,
      description: description.trim() || null,
      carInfo,
    };

    let result;
    if (isEditing) {
      result = await expenseService.editExpense(expense.id, expenseData);
    } else {
      result = await expenseService.createExpense(expenseData);
    }

    setSaving(false);

    if (result.success) {
      Alert.alert('Sucesso', isEditing ? 'Despesa atualizada!' : 'Despesa registrada!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } else {
      Alert.alert('Erro', result.error || 'Falha ao salvar despesa.');
    }
  };

  const renderCategoryIcon = (iconName: string, color: string, size: number = 18) => {
    const IconComp = CATEGORY_ICONS[iconName];
    if (!IconComp) return null;
    return <IconComp size={size} color={color} />;
  };

  const selectedCatInfo = category ? EXPENSE_CATEGORIES[category] : null;
  const selectedSubInfo = subcategory ? getSubcategories.find(s => s.key === subcategory) : null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.carLabel}>{carInfo}</Text>

        {/* Categoria */}
        <Text style={styles.label}>Categoria *</Text>
        <TouchableOpacity
          style={styles.selectBox}
          onPress={() => {
            setShowCategoryPicker(!showCategoryPicker);
            setShowSubcategoryPicker(false);
          }}
        >
          {selectedCatInfo ? (
            <View style={styles.selectValue}>
              {renderCategoryIcon(selectedCatInfo.icon, selectedCatInfo.color)}
              <Text style={styles.selectValueText}>{selectedCatInfo.label}</Text>
            </View>
          ) : (
            <Text style={styles.selectPlaceholder}>Selecione a categoria</Text>
          )}
          <ChevronDown size={20} color="#9CA3AF" style={showCategoryPicker ? { transform: [{ rotate: '180deg' }] } : undefined} />
        </TouchableOpacity>

        {showCategoryPicker && (
          <View style={styles.pickerList}>
            {(Object.keys(EXPENSE_CATEGORIES) as Category[]).map(key => {
              const cat = EXPENSE_CATEGORIES[key];
              const isActive = category === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.pickerItem, isActive && styles.pickerItemActive]}
                  onPress={() => {
                    setCategory(key);
                    setShowCategoryPicker(false);
                  }}
                >
                  {renderCategoryIcon(cat.icon, isActive ? '#4F46E5' : cat.color)}
                  <Text style={[styles.pickerItemText, isActive && styles.pickerItemTextActive]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Subcategoria */}
        {category !== null && category !== 'seguro' && (
          <>
            <Text style={styles.label}>Subcategoria *</Text>
            <TouchableOpacity
              style={styles.selectBox}
              onPress={() => {
                setShowSubcategoryPicker(!showSubcategoryPicker);
                setShowCategoryPicker(false);
              }}
            >
              {selectedSubInfo ? (
                <Text style={styles.selectValueText}>{selectedSubInfo.label}</Text>
              ) : (
                <Text style={styles.selectPlaceholder}>Selecione a subcategoria</Text>
              )}
              <ChevronDown size={20} color="#9CA3AF" style={showSubcategoryPicker ? { transform: [{ rotate: '180deg' }] } : undefined} />
            </TouchableOpacity>

            {showSubcategoryPicker && (
              <View style={styles.pickerList}>
                {getSubcategories.map(sub => {
                  const isActive = subcategory === sub.key;
                  return (
                    <TouchableOpacity
                      key={sub.key}
                      style={[styles.pickerItem, isActive && styles.pickerItemActive]}
                      onPress={() => {
                        setSubcategory(sub.key);
                        setShowSubcategoryPicker(false);
                        if (sub.key !== 'outros') setCustomSubName('');
                      }}
                    >
                      <Text style={[styles.pickerItemText, isActive && styles.pickerItemTextActive]}>{sub.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {subcategory === 'outros' && (
              <TextInput
                style={[styles.input, { marginTop: 8 }]}
                placeholder="Nome da subcategoria"
                placeholderTextColor="#9CA3AF"
                value={customSubName}
                onChangeText={setCustomSubName}
              />
            )}
          </>
        )}

        {/* Descricao da manutencao */}
        {category === 'manutencao' && (
          <>
            <Text style={styles.label}>Descricao do Servico</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Descreva o servico realizado..."
              placeholderTextColor="#9CA3AF"
              value={maintenanceDescription}
              onChangeText={setMaintenanceDescription}
              multiline
              numberOfLines={3}
            />
          </>
        )}

        {/* Valor */}
        <Text style={styles.label}>Valor (R$) *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: 500,00"
          placeholderTextColor="#9CA3AF"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
        />

        {/* Data */}
        <Text style={styles.label}>Data *</Text>
        <TextInput
          style={styles.input}
          placeholder="DD/MM/AAAA"
          placeholderTextColor="#9CA3AF"
          value={dateText}
          onChangeText={t => setDateText(formatDateInput(t))}
          keyboardType="numeric"
          maxLength={10}
        />

        {/* Dividir com locatario */}
        <View style={styles.switchRow}>
          <View style={styles.switchInfo}>
            <Text style={styles.switchLabel}>Dividir com locatario</Text>
            <Text style={styles.switchHint}>Apenas metade do valor sera descontada do lucro</Text>
          </View>
          <Switch
            value={splitWithTenant}
            onValueChange={setSplitWithTenant}
            trackColor={{ false: '#D1D5DB', true: '#A5B4FC' }}
            thumbColor={splitWithTenant ? '#4F46E5' : '#f4f3f4'}
          />
        </View>

        {/* Observacoes */}
        <Text style={styles.label}>Observacoes</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Observacoes adicionais..."
          placeholderTextColor="#9CA3AF"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />

        {/* Botao salvar */}
        <TouchableOpacity
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>{isEditing ? 'Atualizar Despesa' : 'Salvar Despesa'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F3F4F6' },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 100 },
  carLabel: { fontSize: 14, color: '#4F46E5', fontWeight: '600', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8, marginTop: 16 },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10,
    padding: 14, backgroundColor: '#fff',
  },
  selectValue: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectValueText: { fontSize: 15, color: '#1F2937', fontWeight: '600' },
  selectPlaceholder: { fontSize: 15, color: '#9CA3AF' },
  pickerList: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, marginTop: 4, overflow: 'hidden',
  },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  pickerItemActive: { backgroundColor: '#EEF2FF' },
  pickerItemText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  pickerItemTextActive: { color: '#4F46E5', fontWeight: '700' },
  input: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10,
    padding: 14, fontSize: 15, backgroundColor: '#fff', color: '#1F2937',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', padding: 16, borderRadius: 12, marginTop: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  switchInfo: { flex: 1, marginRight: 12 },
  switchLabel: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  switchHint: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  saveButton: {
    backgroundColor: '#4F46E5', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 24,
  },
  saveButtonText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
});

export default AddExpenseScreen;
