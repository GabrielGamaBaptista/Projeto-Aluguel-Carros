// src/components/ImageViewer.tsx
// Visualizador de imagem fullscreen com zoom, share e download
import React, { useState, useRef } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, Modal,
  ScrollView, Dimensions, SafeAreaView, Share, Alert,
  ActivityIndicator, PermissionsAndroid, Platform,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ImageViewer = ({ visible, imageUrl, title, onClose }) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const scrollRef = useRef(null);

  if (!visible) return null;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${title || 'Documento'}: ${imageUrl}`,
        url: imageUrl, // iOS
        title: title || 'Documento',
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleDownload = async () => {
    // Abrir no navegador para download nativo
    const { Linking } = require('react-native');
    try {
      await Linking.openURL(imageUrl);
    } catch {
      Alert.alert('Erro', 'Nao foi possivel abrir a imagem para download.');
    }
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Foto'}</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
              <Text style={styles.actionBtnText}>↗</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleDownload}>
              <Text style={styles.actionBtnText}>⬇</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Imagem com zoom */}
        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          maximumZoomScale={5}
          minimumZoomScale={1}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          bouncesZoom={true}
          centerContent={true}
        >
          {!imageLoaded && !imageError && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
            </View>
          )}
          {imageError ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>Erro ao carregar imagem</Text>
            </View>
          ) : (
            <Image
              source={{ uri: imageUrl }}
              style={styles.image}
              resizeMode="contain"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
          )}
        </ScrollView>

        {/* Dica de zoom */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Pinça para dar zoom</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, backgroundColor: 'rgba(0,0,0,0.8)',
  },
  closeButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#374151',
    justifyContent: 'center', alignItems: 'center',
  },
  closeButtonText: { fontSize: 18, color: '#fff', fontWeight: 'bold' },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff', marginHorizontal: 12, textAlign: 'center' },
  headerActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#374151',
    justifyContent: 'center', alignItems: 'center',
  },
  actionBtnText: { fontSize: 18, color: '#fff' },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.75 },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  errorContainer: { justifyContent: 'center', alignItems: 'center', padding: 40 },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorText: { color: '#9CA3AF', fontSize: 16 },
  footer: { padding: 12, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)' },
  footerText: { fontSize: 12, color: '#6B7280' },
});

export default ImageViewer;
