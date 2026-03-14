// src/config/firebase.js
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';

export { auth, firestore };

// Firebase já está configurado pelo google-services.json!
// Não precisa de initializeApp() no React Native Firebase
