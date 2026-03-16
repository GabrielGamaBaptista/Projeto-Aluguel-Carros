// src/components/PhotoPicker.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Camera } from 'lucide-react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { uploadImageToCloudinary } from '../config/cloudinary';

const PhotoPicker = ({ onPhotoSelected, label, currentPhotoUrl }) => {
  const [loading, setLoading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(currentPhotoUrl || null);

  // M2: Sincronizar com mudanças externas do currentPhotoUrl
  useEffect(() => {
    setPhotoUrl(currentPhotoUrl || null);
  }, [currentPhotoUrl]);

  const showImagePicker = () => {
    Alert.alert(
      'Selecionar Foto',
      'Escolha uma opção',
      [
        {
          text: 'Câmera',
          onPress: () => openCamera(),
        },
        {
          text: 'Galeria',
          onPress: () => openGallery(),
        },
        {
          text: 'Cancelar',
          style: 'cancel',
        },
      ]
    );
  };

  const openCamera = async () => {
    const result = await launchCamera({
      mediaType: 'photo',
      quality: 0.8,
      saveToPhotos: true,
    });

    if (result.didCancel) return;
    if (result.errorCode) {
      Alert.alert('Erro', result.errorMessage || 'Erro ao abrir câmera');
      return;
    }
    if (result.assets && result.assets[0]) {
      uploadPhoto(result.assets[0].uri);
    }
  };

  const openGallery = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });

    if (result.didCancel) return;
    if (result.errorCode) {
      Alert.alert('Erro', result.errorMessage || 'Erro ao abrir galeria');
      return;
    }
    if (result.assets && result.assets[0]) {
      uploadPhoto(result.assets[0].uri);
    }
  };

  const uploadPhoto = async (uri) => {
    setLoading(true);
    const result = await uploadImageToCloudinary(uri);
    setLoading(false);

    if (result.success) {
      setPhotoUrl(result.url);
      onPhotoSelected(result.url);
    } else {
      Alert.alert('Erro', 'Falha ao fazer upload da foto. Verifique sua conexão.');
    }
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      
      <TouchableOpacity
        style={styles.photoButton}
        onPress={showImagePicker}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#4F46E5" />
        ) : photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photo} />
        ) : (
          <View style={styles.placeholder}>
            <Camera size={32} color="#9CA3AF" />
            <Text style={styles.placeholderSubtext}>Tirar Foto</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#1F2937',
  },
  photoButton: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  placeholder: {
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 48,
    marginBottom: 8,
  },
  placeholderSubtext: {
    fontSize: 16,
    color: '#6B7280',
  },
});

export default PhotoPicker;
