// src/components/PdfViewer.tsx
// Visualizador de PDF multi-pagina usando transformacoes do Cloudinary
// Cada pagina do PDF e renderizada como imagem via pg_N
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Modal, Dimensions, SafeAreaView,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PAGE_WIDTH = SCREEN_WIDTH - 32; // margem lateral
const PAGE_HEIGHT = PAGE_WIDTH * 1.414; // proporcao A4

// Gera URL de uma pagina especifica do PDF
const getPageUrl = (pdfUrl, pageNum, fullRes = true) => {
  if (!pdfUrl) return null;
  const jpgUrl = pdfUrl.replace(/\.pdf$/i, '.jpg');
  const quality = fullRes ? 'w_1200,q_auto:best' : 'w_800,q_auto';
  return jpgUrl.replace('/upload/', `/upload/${quality},pg_${pageNum}/`);
};

const PdfViewer = ({ visible, pdfUrl, title, onClose }) => {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const MAX_PAGES = 30; // limite de seguranca

  useEffect(() => {
    if (visible && pdfUrl) {
      loadPages();
    } else {
      // Reset ao fechar
      setPages([]);
      setTotalPages(0);
      setLoading(true);
    }
  }, [visible, pdfUrl]);

  const loadPages = async () => {
    setLoading(true);
    const loadedPages = [];

    // Tentar carregar paginas ate encontrar erro
    for (let i = 1; i <= MAX_PAGES; i++) {
      const url = getPageUrl(pdfUrl, i);
      const exists = await checkImageExists(url);

      if (exists) {
        loadedPages.push({ pageNum: i, url });
      } else {
        // Pagina nao existe = acabaram as paginas
        break;
      }
    }

    setPages(loadedPages);
    setTotalPages(loadedPages.length);
    setLoading(false);
  };

  // Verifica se uma URL de imagem existe (HEAD request)
  const checkImageExists = async (url) => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Documento'}</Text>
            {totalPages > 0 && (
              <Text style={styles.headerPages}>{totalPages} pagina{totalPages > 1 ? 's' : ''}</Text>
            )}
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Conteudo */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4F46E5" />
            <Text style={styles.loadingText}>Carregando documento...</Text>
          </View>
        ) : pages.length === 0 ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>Nao foi possivel carregar o documento</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
          >
            {pages.map((page) => (
              <View key={page.pageNum} style={styles.pageContainer}>
                <View style={styles.pageHeader}>
                  <Text style={styles.pageNumber}>Pagina {page.pageNum} de {totalPages}</Text>
                </View>
                <Image
                  source={{ uri: page.url }}
                  style={styles.pageImage}
                  resizeMode="contain"
                />
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1F2937' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#374151',
  },
  headerInfo: { flex: 1, marginRight: 16 },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  headerPages: { fontSize: 13, color: '#9CA3AF', marginTop: 2 },
  closeButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#374151',
    justifyContent: 'center', alignItems: 'center',
  },
  closeButtonText: { fontSize: 18, color: '#fff', fontWeight: 'bold' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#9CA3AF', fontSize: 14, marginTop: 16 },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorText: { color: '#9CA3AF', fontSize: 16 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  pageContainer: {
    marginBottom: 16, backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  pageHeader: {
    padding: 8, backgroundColor: '#F3F4F6', borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  pageNumber: { fontSize: 12, color: '#6B7280', textAlign: 'center' },
  pageImage: {
    width: PAGE_WIDTH - 2, // -2 pelo border
    height: PAGE_HEIGHT,
    backgroundColor: '#fff',
  },
});

export default PdfViewer;
