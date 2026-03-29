// src/config/cloudinary.js
import functions from '@react-native-firebase/functions';

const getSignatureFromBackend = async () => {
  try {
    const getCloudinarySignature = functions().httpsCallable('getCloudinarySignature');
    const result = await getCloudinarySignature();
    return result.data;
  } catch (error) {
    console.error('Error getting Cloudinary signature:', error);
    throw error;
  }
};

// Upload de IMAGENS (jpg, png)
// options.fileSizeBytes: tamanho do arquivo em bytes (opcional — validacao SEC-11)
export const uploadImageToCloudinary = async (imageUri, options = {}) => {
  // SEC-11: validacao de tamanho antes do upload (10MB para imagens)
  const { fileSizeBytes = null } = options;
  if (fileSizeBytes !== null && fileSizeBytes > 10 * 1024 * 1024) {
    return { success: false, error: 'Imagem muito grande. Maximo 10MB.' };
  }

  try {
    const { signature, timestamp, apiKey, cloudName, folder } = await getSignatureFromBackend();

    // SEC-21: cloudName vem exclusivamente do backend — sem fallback hardcoded
    if (!cloudName) {
      return { success: false, error: 'Configuracao de upload indisponivel.' };
    }

    const formData = new FormData();
    formData.append('file', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'photo.jpg',
    });
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData }
    );

    const data = await response.json();
    if (data.secure_url) {
      return { success: true, url: data.secure_url };
    }
    return { success: false, error: data.error?.message || 'Upload failed' };
  } catch (error) {
    console.error('Cloudinary image upload error:', error);
    return { success: false, error: error.message };
  }
};

// Upload de PDFs como IMAGE (nao raw!)
// options.fileSizeBytes: tamanho do arquivo em bytes (opcional — validacao SEC-11)
export const uploadFileToCloudinary = async (fileUri, fileName, mimeType, options = {}) => {
  // SEC-11: validacao de tamanho antes do upload (20MB para PDFs)
  const { fileSizeBytes = null } = options;
  if (fileSizeBytes !== null && fileSizeBytes > 20 * 1024 * 1024) {
    return { success: false, error: 'Arquivo muito grande. Maximo 20MB.' };
  }

  try {
    const { signature, timestamp, apiKey, cloudName, folder } = await getSignatureFromBackend();

    if (!cloudName) {
      return { success: false, error: 'Configuracao de upload indisponivel.' };
    }

    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      type: mimeType || 'application/pdf',
      name: fileName || 'document.pdf',
    });
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData }
    );

    const data = await response.json();
    if (data.secure_url) {
      return { success: true, url: data.secure_url };
    }
    return { success: false, error: data.error?.message || 'Upload failed' };
  } catch (error) {
    console.error('Cloudinary file upload error:', error);
    return { success: false, error: error.message };
  }
};

// Gerar URL de thumbnail/preview de um PDF no Cloudinary
export const getPdfPreviewUrl = (pdfUrl) => {
  if (!pdfUrl) return null;
  const previewUrl = pdfUrl.replace(/\.pdf$/i, '.jpg');
  return previewUrl.replace('/upload/', '/upload/w_400,h_300,c_fit,pg_1/');
};

// Gerar URL full resolution do PDF
export const getPdfFullUrl = (pdfUrl) => {
  if (!pdfUrl) return null;
  const fullUrl = pdfUrl.replace(/\.pdf$/i, '.jpg');
  return fullUrl.replace('/upload/', '/upload/w_1200,q_auto:best,pg_1/');
};
