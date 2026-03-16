// src/components/DocumentPicker.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Alert,
  ActivityIndicator, Linking,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { pick, types } from '@react-native-documents/picker';
import { uploadImageToCloudinary, uploadFileToCloudinary, getPdfPreviewUrl, getPdfFullUrl } from '../config/cloudinary';
import { Paperclip, FileText, Image as ImageIcon } from 'lucide-react-native';
import PdfViewer from './PdfViewer';

const DocumentPicker = ({ onDocumentSelected, label, currentDocument }) => {
  const [loading, setLoading] = useState(false);
  const [doc, setDoc] = useState(currentDocument || null);
  const [showPdfViewer, setShowPdfViewer] = useState(false);

  useEffect(() => { setDoc(currentDocument || null); }, [currentDocument]);

  const showPicker = () => {
    Alert.alert(
      'Selecionar Documento',
      'Escolha o formato do documento',
      [
        { text: 'PDF (Arquivo)', onPress: pickPdf },
        { text: 'Foto (Camera)', onPress: openCamera },
        { text: 'Foto (Galeria)', onPress: openGallery },
        { text: 'Cancelar', style: 'cancel' },
      ]
    );
  };

  const pickPdf = async () => {
    try {
      const [result] = await pick({ type: [types.pdf] });

      if (result) {
        const uri = result.uri;
        const fileName = result.name || 'document.pdf';

        setLoading(true);
        const uploadResult = await uploadFileToCloudinary(uri, fileName, 'application/pdf');
        setLoading(false);

        if (uploadResult.success) {
          const previewUrl = getPdfPreviewUrl(uploadResult.url);
          const docData = {
            url: uploadResult.url,
            type: 'pdf',
            name: fileName,
            preview: previewUrl,
          };
          setDoc(docData);
          onDocumentSelected(docData);
        } else {
          Alert.alert('Erro', 'Falha ao fazer upload do PDF. Tente novamente.');
        }
      }
    } catch (error) {
      setLoading(false);
      if (error?.code === 'DOCUMENT_PICKER_CANCELED' || error?.message?.includes('cancel')) return;
      console.error('Pick PDF error:', error);
      Alert.alert('Erro', 'Erro ao selecionar arquivo.');
    }
  };

  const openCamera = async () => {
    const result = await launchCamera({ mediaType: 'photo', quality: 0.8, saveToPhotos: true });
    if (result.didCancel || result.errorCode) return;
    if (result.assets && result.assets[0]) uploadPhoto(result.assets[0].uri);
  };

  const openGallery = async () => {
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8 });
    if (result.didCancel || result.errorCode) return;
    if (result.assets && result.assets[0]) uploadPhoto(result.assets[0].uri);
  };

  const uploadPhoto = async (uri) => {
    setLoading(true);
    const result = await uploadImageToCloudinary(uri);
    setLoading(false);
    if (result.success) {
      const docData = { url: result.url, type: 'photo', name: 'foto_documento.jpg', preview: result.url };
      setDoc(docData);
      onDocumentSelected(docData);
    } else {
      Alert.alert('Erro', 'Falha ao fazer upload da foto.');
    }
  };

  const handleRemove = () => {
    setDoc(null);
    onDocumentSelected(null);
  };

  const handleView = () => {
    if (!doc || !doc.url) return;
    if (doc.type === 'pdf') {
      setShowPdfViewer(true);
    } else {
      // Fotos abrem direto no navegador (funciona sem restricao)
      Linking.openURL(doc.url).catch(() => Alert.alert('Erro', 'Nao foi possivel abrir o documento.'));
    }
  };

  // URL para preview: foto usa url direto, PDF usa thumbnail gerado pelo Cloudinary
  const getPreviewUri = () => {
    if (!doc) return null;
    if (doc.type === 'photo') return doc.url;
    if (doc.preview) return doc.preview;
    // Fallback: tentar gerar preview a partir da URL
    return getPdfPreviewUrl(doc.url);
  };

  return (
    <View style={styles.container}>
      {doc ? (
        <View style={styles.docCard}>
          {/* Preview inline — funciona para foto e PDF */}
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: getPreviewUri() }}
              style={styles.previewImage}
              resizeMode="cover"
            />
            {doc.type === 'pdf' && (
              <View style={styles.pdfBadge}>
                <Text style={styles.pdfBadgeText}>PDF</Text>
              </View>
            )}
          </View>

          {/* Nome do arquivo */}
          <View style={styles.docInfo}>
            <View style={styles.docNameRow}>
              {doc.type === 'pdf'
                ? <FileText size={14} color="#6B7280" />
                : <ImageIcon size={14} color="#6B7280" />}
              <Text style={styles.docName} numberOfLines={1}> {doc.name}</Text>
            </View>
          </View>

          {/* Acoes */}
          <View style={styles.docActions}>
            <TouchableOpacity style={styles.viewBtn} onPress={handleView}>
              <Text style={styles.viewBtnText}>Visualizar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.removeBtn} onPress={handleRemove}>
              <Text style={styles.removeBtnText}>Remover</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.pickButton} onPress={showPicker} disabled={loading}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#4F46E5" />
              <Text style={styles.loadingText}>Enviando...</Text>
            </View>
          ) : (
            <View style={styles.placeholder}>
              <Paperclip size={32} color="#6B7280" />
              <Text style={styles.placeholderText}>{label || 'Anexar Documento'}</Text>
              <Text style={styles.placeholderHint}>PDF ou Foto</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Visualizador PDF multi-pagina */}
      <PdfViewer
        visible={showPdfViewer}
        pdfUrl={doc?.url}
        title={doc?.name}
        onClose={() => setShowPdfViewer(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 8 },
  pickButton: {
    borderWidth: 2, borderColor: '#D1D5DB', borderStyle: 'dashed', borderRadius: 12,
    padding: 20, alignItems: 'center', backgroundColor: '#F9FAFB',
  },
  placeholder: { alignItems: 'center' },
  placeholderIcon: { fontSize: 32, marginBottom: 4 },
  placeholderText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  placeholderHint: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  loadingContainer: { alignItems: 'center' },
  loadingText: { fontSize: 12, color: '#6B7280', marginTop: 8 },
  docCard: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  previewContainer: { position: 'relative' },
  previewImage: { width: '100%', height: 160, backgroundColor: '#F3F4F6' },
  pdfBadge: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: '#DC2626', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  pdfBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  docInfo: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  docNameRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  docName: { fontSize: 13, fontWeight: '600', color: '#374151', flex: 1 },
  docActions: { flexDirection: 'row' },
  viewBtn: { flex: 1, padding: 12, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#E5E7EB' },
  viewBtnText: { fontSize: 14, fontWeight: '600', color: '#4F46E5' },
  removeBtn: { flex: 1, padding: 12, alignItems: 'center' },
  removeBtnText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
});

export default DocumentPicker;
