// src/screens/TenantDetailsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Linking, Alert,
} from 'react-native';
import { usersService } from '../services/usersService';
import ImageViewer from '../components/ImageViewer';

const TenantDetailsScreen = ({ route }) => {
  const { tenantId } = route.params;
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageViewer, setImageViewer] = useState({ visible: false, url: null, title: '' });

  useEffect(() => { loadTenant(); }, []);

  const loadTenant = async () => {
    const result = await usersService.getUserById(tenantId);
    if (result.success) setTenant(result.data);
    setLoading(false);
  };

  const openPhoto = (url, title) => {
    setImageViewer({ visible: true, url, title: title || 'Foto' });
  };

  const handleCall = (phone) => {
    const cleanPhone = phone?.replace(/\D/g, '');
    if (!cleanPhone) { Alert.alert('Erro', 'Telefone nao informado.'); return; }
    Linking.openURL(`tel:+55${cleanPhone}`).catch(() => Alert.alert('Erro', 'Nao foi possivel abrir o discador.'));
  };

  const handleWhatsApp = (phone) => {
    const cleanPhone = phone?.replace(/\D/g, '');
    if (!cleanPhone) { Alert.alert('Erro', 'Telefone nao informado.'); return; }
    const url = `https://wa.me/55${cleanPhone}`;
    Linking.openURL(url).catch(() => Alert.alert('Erro', 'Nao foi possivel abrir o WhatsApp.'));
  };

  const handleEmail = (email) => {
    if (!email) { Alert.alert('Erro', 'Email nao informado.'); return; }
    Linking.openURL(`mailto:${email}`).catch(() => Alert.alert('Erro', 'Nao foi possivel abrir o email.'));
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  if (!tenant) return <View style={styles.center}><Text style={styles.errorText}>Locatario nao encontrado</Text></View>;

  const InfoRow = ({ label, value }) => (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Nao informado'}</Text>
    </View>
  );

  const PhotoCard = ({ label, url }) => {
    if (!url) {
      return (
        <View style={styles.photoCard}>
          <Text style={styles.photoLabel}>{label}</Text>
          <View style={styles.noPhoto}><Text style={styles.noPhotoText}>Nao enviado</Text></View>
        </View>
      );
    }
    return (
      <View style={styles.photoCard}>
        <Text style={styles.photoLabel}>{label}</Text>
        <TouchableOpacity onPress={() => openPhoto(url, label)}>
          <Image source={{ uri: url }} style={styles.photoImage} />
          <Text style={styles.tapToExpand}>Toque para ampliar</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const formatCpf = (cpf) => {
    if (!cpf) return 'Nao informado';
    const c = cpf.replace(/\D/g, '');
    if (c.length !== 11) return cpf;
    return c.slice(0, 3) + '.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-' + c.slice(9);
  };

  const hasPhone = !!tenant.phone?.replace(/\D/g, '');

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{tenant.name?.charAt(0)?.toUpperCase() || '?'}</Text>
        </View>
        <Text style={styles.name}>{tenant.name}</Text>
        <Text style={styles.role}>Locatario</Text>
      </View>

      {/* Botoes de contato rapido */}
      <View style={styles.contactButtons}>
        {hasPhone && (
          <TouchableOpacity style={styles.contactBtn} onPress={() => handleCall(tenant.phone)}>
            <Text style={styles.contactBtnIcon}>📞</Text>
            <Text style={styles.contactBtnText}>Ligar</Text>
          </TouchableOpacity>
        )}
        {hasPhone && (
          <TouchableOpacity style={[styles.contactBtn, styles.whatsappBtn]} onPress={() => handleWhatsApp(tenant.phone)}>
            <Text style={styles.contactBtnIcon}>💬</Text>
            <Text style={[styles.contactBtnText, styles.whatsappText]}>WhatsApp</Text>
          </TouchableOpacity>
        )}
        {tenant.email && (
          <TouchableOpacity style={styles.contactBtn} onPress={() => handleEmail(tenant.email)}>
            <Text style={styles.contactBtnIcon}>📧</Text>
            <Text style={styles.contactBtnText}>Email</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Contato */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contato</Text>
        <InfoRow label="Email" value={tenant.email} />
        <InfoRow label="Telefone" value={tenant.phone} />
        <InfoRow label="Endereco" value={tenant.address || [tenant.street, tenant.number, tenant.neighborhood, tenant.city].filter(Boolean).join(', ')} />
      </View>

      {/* Dados pessoais */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dados Pessoais</Text>
        <InfoRow label="CPF" value={formatCpf(tenant.cpf)} />
        <InfoRow label="Data de Nascimento" value={tenant.birthDate} />
      </View>

      {/* CNH */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CNH</Text>
        <InfoRow label="Numero" value={tenant.cnhNumber} />
        <InfoRow label="Categoria" value={tenant.cnhCategory} />
        <InfoRow label="Validade" value={tenant.cnhExpiry} />
        <PhotoCard label="CNH - Frente" url={tenant.cnhFrontPhoto} />
        <PhotoCard label="CNH - Verso" url={tenant.cnhBackPhoto} />
      </View>

      {/* Comprovante */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Comprovante de Residencia</Text>
        <PhotoCard label="Comprovante" url={tenant.residenceProofPhoto} />
      </View>

      <View style={styles.bottomSpace} />

      <ImageViewer
        visible={imageViewer.visible}
        imageUrl={imageViewer.url}
        title={imageViewer.title}
        onClose={() => setImageViewer({ visible: false, url: null, title: '' })}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: '#6B7280' },
  header: { backgroundColor: '#4F46E5', padding: 32, alignItems: 'center' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 36, fontWeight: 'bold', color: '#4F46E5' },
  name: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  role: { fontSize: 14, color: '#C7D2FE', marginTop: 4 },
  // Contact buttons
  contactButtons: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6', gap: 6 },
  whatsappBtn: { backgroundColor: '#D1FAE5' },
  contactBtnIcon: { fontSize: 18 },
  contactBtnText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  whatsappText: { color: '#065F46' },
  // Sections
  section: { backgroundColor: '#fff', marginTop: 12, padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  infoLabel: { fontSize: 14, color: '#6B7280', flex: 1 },
  infoValue: { fontSize: 14, fontWeight: '600', color: '#1F2937', flex: 2, textAlign: 'right' },
  photoCard: { marginTop: 16 },
  photoLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  photoImage: { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#E5E7EB' },
  tapToExpand: { textAlign: 'center', fontSize: 12, color: '#4F46E5', marginTop: 4 },
  noPhoto: { height: 100, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  noPhotoText: { color: '#9CA3AF', fontSize: 14 },
  bottomSpace: { height: 40 },
});

export default TenantDetailsScreen;
