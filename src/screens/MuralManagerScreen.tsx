// src/screens/MuralManagerScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, FlatList, Modal, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Megaphone } from 'lucide-react-native';
import { MdiPin } from '../components/icons/MdiIcons';
import { authService } from '../services/authService';
import { muralService, MURAL_CATEGORIES } from '../services/muralService';
import { carsService } from '../services/carsService';
import { usersService } from '../services/usersService';

const MuralManagerScreen = ({ navigation }) => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingPost, setEditingPost] = useState(null);

  // Editor fields
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('geral');
  const [targetType, setTargetType] = useState('all');
  const [targetTenantId, setTargetTenantId] = useState(null);
  const [targetCarId, setTargetCarId] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => { loadPosts(); });
    return unsubscribe;
  }, [navigation]);

  const loadPosts = async () => {
    const user = authService.getCurrentUser();
    if (!user) return;
    const result = await muralService.getPostsByLandlord(user.uid);
    if (result.success) setPosts(result.data);
    setLoading(false);
  };

  const loadTenants = async () => {
    const user = authService.getCurrentUser();
    if (!user) return;
    const carsResult = await carsService.getCarsByLandlord(user.uid);
    if (carsResult.success) {
      const tenantsList = [];
      for (const car of carsResult.data) {
        if (car.tenantId) {
          const tenantResult = await usersService.getUserById(car.tenantId);
          if (tenantResult.success) {
            tenantsList.push({
              id: car.tenantId,
              name: tenantResult.data.name,
              car: `${car.brand} ${car.model} - ${car.plate}`,
              carId: car.id,
            });
          }
        }
      }
      setTenants(tenantsList);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPosts();
    setRefreshing(false);
  };

  const openEditor = (post = null) => {
    if (post) {
      setEditingPost(post);
      setTitle(post.title || '');
      setContent(post.content || '');
      setCategory(post.category || 'geral');
      setTargetType(post.targetType || 'all');
      setTargetTenantId(post.targetTenantId || null);
      setTargetCarId(post.targetCarId || null);
      setPinned(post.pinned || false);
    } else {
      setEditingPost(null);
      setTitle('');
      setContent('');
      setCategory('geral');
      setTargetType('all');
      setTargetTenantId(null);
      setTargetCarId(null);
      setPinned(false);
    }
    loadTenants();
    setShowEditor(true);
  };

  const handleSave = async () => {
    if (!content.trim()) {
      Alert.alert('Erro', 'Escreva o conteudo do post.');
      return;
    }

    setSaving(true);
    const user = authService.getCurrentUser();

    if (editingPost) {
      const result = await muralService.updatePost(editingPost.id, {
        title, content, category, targetType, targetTenantId, targetCarId, pinned,
      });
      if (result.success) {
        Alert.alert('Sucesso', 'Post atualizado!');
      } else {
        Alert.alert('Erro', result.error);
      }
    } else {
      const result = await muralService.createPost(user.uid, {
        title, content, category, targetType, targetTenantId, targetCarId, pinned,
      });
      if (result.success) {
        Alert.alert('Sucesso', 'Post publicado no mural!');
      } else {
        Alert.alert('Erro', result.error);
      }
    }

    setSaving(false);
    setShowEditor(false);
    loadPosts();
  };

  const handleDelete = (postId) => {
    Alert.alert('Deletar Post', 'Tem certeza?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Deletar', style: 'destructive',
        onPress: async () => {
          await muralService.deletePost(postId);
          loadPosts();
        },
      },
    ]);
  };

  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) return '';
    try { return timestamp.toDate().toLocaleDateString('pt-BR'); }
    catch { return ''; }
  };

  const getCategoryLabel = (val) => MURAL_CATEGORIES.find(c => c.value === val)?.label || val;

  const renderPost = ({ item }) => (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.postMeta}>
          {item.pinned && (
            <View style={styles.pinnedBadge}>
              <MdiPin size={12} color="#B45309" />
              <Text style={styles.pinnedBadgeText}> Fixado</Text>
            </View>
          )}
          <Text style={styles.categoryBadge}>{getCategoryLabel(item.category)}</Text>
          <Text style={styles.targetBadge}>
            {item.targetType === 'all' ? 'Todos' : 'Especifico'}
          </Text>
        </View>
        <Text style={styles.postDate}>{formatDate(item.createdAt)}</Text>
      </View>

      {item.title ? <Text style={styles.postTitle}>{item.title}</Text> : null}
      <Text style={styles.postContent}>{item.content}</Text>

      <View style={styles.postActions}>
        <TouchableOpacity style={styles.editBtn} onPress={() => openEditor(item)}>
          <Text style={styles.editBtnText}>Editar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)}>
          <Text style={styles.deleteBtnText}>Deletar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Mural de Avisos</Text>
          <Text style={styles.headerSubtitle}>{posts.length} post{posts.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={() => openEditor()}>
          <Text style={styles.addButtonText}>+ Novo Post</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Megaphone size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>Nenhum post no mural</Text>
            <Text style={styles.emptySubtitle}>Crie posts para informar seus locatarios</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {/* Editor Modal */}
      <Modal visible={showEditor} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView style={styles.modalScroll}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{editingPost ? 'Editar Post' : 'Novo Post'}</Text>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Titulo (opcional)</Text>
                <TextInput style={styles.modalInput} placeholderTextColor="#9CA3AF" placeholder="Ex: Informacoes de Pagamento"
                  value={title} onChangeText={setTitle} />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Conteudo *</Text>
                <TextInput style={[styles.modalInput, styles.textArea]}
                  placeholder="Escreva o conteudo do aviso..."
                  value={content} onChangeText={setContent} multiline numberOfLines={5} />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Categoria</Text>
                <View style={styles.categoriesRow}>
                  {MURAL_CATEGORIES.map(cat => (
                    <TouchableOpacity key={cat.value}
                      style={[styles.catBtn, category === cat.value && styles.catBtnActive]}
                      onPress={() => setCategory(cat.value)}>
                      <Text style={[styles.catBtnText, category === cat.value && styles.catBtnTextActive]}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Destino</Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    style={[styles.targetBtn, targetType === 'all' && styles.targetBtnActive]}
                    onPress={() => { setTargetType('all'); setTargetTenantId(null); }}>
                    <Text style={[styles.targetBtnText, targetType === 'all' && styles.targetBtnTextActive]}>Todos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.targetBtn, targetType === 'specific' && styles.targetBtnActive]}
                    onPress={() => setTargetType('specific')}>
                    <Text style={[styles.targetBtnText, targetType === 'specific' && styles.targetBtnTextActive]}>Especifico</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {targetType === 'specific' && (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Selecione o Locatario</Text>
                  {tenants.length === 0 ? (
                    <Text style={styles.noTenants}>Nenhum locatario atribuido</Text>
                  ) : (
                    tenants.map(t => (
                      <TouchableOpacity key={t.id}
                        style={[styles.tenantOption, targetTenantId === t.id && styles.tenantOptionActive]}
                        onPress={() => { setTargetTenantId(t.id); setTargetCarId(t.carId); }}>
                        <Text style={styles.tenantName}>{t.name}</Text>
                        <Text style={styles.tenantCar}>{t.car}</Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              )}

              <TouchableOpacity style={[styles.pinToggle, pinned && styles.pinToggleActive]}
                onPress={() => setPinned(!pinned)}>
                <View style={styles.pinToggleContent}>
                  <MdiPin size={16} color={pinned ? '#B45309' : '#9CA3AF'} />
                  <Text style={[styles.pinToggleText, pinned && { color: '#B45309' }]}> {pinned ? 'Fixado no topo' : 'Fixar no topo?'}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.saveButton, saving && styles.buttonDisabled]}
                onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveButtonText}>{editingPost ? 'Salvar Alteracoes' : 'Publicar'}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowEditor(false)}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#fff', padding: 20, paddingTop: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#1F2937' },
  headerSubtitle: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  addButton: { backgroundColor: '#4F46E5', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  list: { padding: 16 },
  postCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, elevation: 2 },
  postHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  postMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pinnedBadge: { flexDirection: 'row', alignItems: 'center' },
  pinnedBadgeText: { fontSize: 12, color: '#B45309', fontWeight: '700' },
  categoryBadge: { backgroundColor: '#EEF2FF', color: '#4F46E5', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  targetBadge: { backgroundColor: '#F3F4F6', color: '#6B7280', fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  postDate: { fontSize: 12, color: '#9CA3AF' },
  postTitle: { fontSize: 17, fontWeight: 'bold', color: '#1F2937', marginBottom: 6 },
  postContent: { fontSize: 14, color: '#374151', lineHeight: 21 },
  postActions: { flexDirection: 'row', gap: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 12 },
  editBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#EEF2FF', borderRadius: 6 },
  editBtnText: { color: '#4F46E5', fontWeight: '600', fontSize: 13 },
  deleteBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#FEF2F2', borderRadius: 6 },
  deleteBtnText: { color: '#DC2626', fontWeight: '600', fontSize: 13 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  pinToggleContent: { flexDirection: 'row', alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 4 },
  emptySubtitle: { fontSize: 14, color: '#6B7280' },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalScroll: { flex: 1, marginTop: 60 },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, minHeight: '100%' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1F2937', marginBottom: 20 },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  modalInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#F9FAFB', color: '#1F2937' },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  categoriesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#D1D5DB' },
  catBtnActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  catBtnText: { fontSize: 13, color: '#6B7280' },
  catBtnTextActive: { color: '#4F46E5', fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12 },
  targetBtn: { flex: 1, padding: 14, borderRadius: 8, borderWidth: 2, borderColor: '#D1D5DB', alignItems: 'center' },
  targetBtnActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  targetBtnText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  targetBtnTextActive: { color: '#4F46E5' },
  noTenants: { color: '#9CA3AF', fontSize: 14 },
  tenantOption: { padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 8 },
  tenantOptionActive: { borderColor: '#4F46E5', backgroundColor: '#EEF2FF' },
  tenantName: { fontSize: 15, fontWeight: '600', color: '#1F2937' },
  tenantCar: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  pinToggle: { padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', marginBottom: 20 },
  pinToggleActive: { borderColor: '#B45309', backgroundColor: '#FFFBEB' },
  pinToggleText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  saveButton: { backgroundColor: '#4F46E5', padding: 16, borderRadius: 8, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelButton: { padding: 16, alignItems: 'center', marginTop: 8 },
  cancelButtonText: { color: '#6B7280', fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
});

export default MuralManagerScreen;
