// src/services/authService.js
import { auth, firestore } from '../config/firebase';

let GoogleSignin = null;
try {
  const googleModule = require('@react-native-google-signin/google-signin');
  GoogleSignin = googleModule.GoogleSignin;
} catch (e) {
  console.warn('Google Sign-In nao disponivel:', e.message);
}

export const authService = {
  checkCpfExists: async (cpf) => {
    try {
      const cleanCpf = cpf.replace(/\D/g, '');
      if (cleanCpf.length !== 11) return { exists: false };
      const snapshot = await firestore().collection('users').where('cpf', '==', cleanCpf).limit(1).get();
      return { exists: !snapshot.empty };
    } catch (error) { return { exists: false }; }
  },

  checkDocumentExists: async (value, type) => {
    try {
      const clean = value.replace(/\D/g, '');
      const field = type === 'cnpj' ? 'cnpj' : 'cpf';
      const snapshot = await firestore().collection('users').where(field, '==', clean).limit(1).get();
      return { exists: !snapshot.empty };
    } catch (error) { return { exists: false }; }
  },

  checkEmailExists: async (email) => {
    try {
      const snapshot = await firestore().collection('users').where('email', '==', email.trim().toLowerCase()).limit(1).get();
      return { exists: !snapshot.empty };
    } catch (error) { return { exists: false }; }
  },

  checkPhoneExists: async (phone) => {
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length < 10) return { exists: false };
      const snapshot = await firestore().collection('users').where('phone', '==', cleanPhone).limit(1).get();
      return { exists: !snapshot.empty };
    } catch (error) { return { exists: false }; }
  },

  register: async (email, password, userData) => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const emailCheck = await authService.checkEmailExists(cleanEmail);
      if (emailCheck.exists) return { success: false, error: 'Este email ja esta em uso.' };

      if (userData.personType === 'pj' || userData.personType === 'mei') {
        if (userData.cnpj) {
          const cnpjCheck = await authService.checkDocumentExists(userData.cnpj, 'cnpj');
          if (cnpjCheck.exists) return { success: false, error: 'Este CNPJ ja esta cadastrado.' };
        }
      } else {
        if (userData.cpf) {
          const cpfCheck = await authService.checkCpfExists(userData.cpf);
          if (cpfCheck.exists) return { success: false, error: 'Este CPF ja esta cadastrado.' };
        }
      }
      if (userData.phone) {
        const phoneCheck = await authService.checkPhoneExists(userData.phone);
        if (phoneCheck.exists) return { success: false, error: 'Este numero ja esta cadastrado.' };
      }

      const userCredential = await auth().createUserWithEmailAndPassword(cleanEmail, password);
      const user = userCredential.user;
      try { await user.sendEmailVerification(); } catch (e) { console.error('Verify email error:', e); }

      // Doc publico: dados de acesso, busca e autenticacao.
      // Fase A (Q1.2): phone ainda duplicado aqui para checkPhoneExists funcionar.
      // Batch 4 (Fase C): remover phone do publico apos migrar checkPhoneExists para admin SDK.
      const publicData = {
        email: cleanEmail, name: userData.name || '', role: userData.role,
        emailVerified: false, authProvider: 'email',
        cpf: userData.cpf || '', cnpj: userData.cnpj || '',
        phone: userData.phone || '',
        createdAt: firestore.FieldValue.serverTimestamp(),
      };

      // Private sub-doc: PII completo (phone, cpf, cnpj, endereco, dados pessoais, CNH)
      // cpf/cnpj ficam em ambos os docs na Fase A para checkCpfExists/login funcionar.
      const privateData = {
        phone: userData.phone || '',
        cpf: userData.cpf || '',
        cnpj: userData.cnpj || '',
        birthDate: userData.birthDate || '',
        personType: userData.personType || 'pf',
        companyName: userData.companyName || '',
        cep: userData.cep || '', street: userData.street || '', number: userData.number || '',
        complement: userData.complement || '', neighborhood: userData.neighborhood || '',
        city: userData.city || '', state: userData.state || '', address: userData.address || '',
      };

      // Campos exclusivos locatario no private
      if (userData.role === 'locatario') {
        Object.assign(privateData, {
          cnhNumber: userData.cnhNumber || '', cnhCategory: userData.cnhCategory || '',
          cnhExpiry: userData.cnhExpiry || '', cnhFrontPhoto: userData.cnhFrontPhoto || '',
          cnhBackPhoto: userData.cnhBackPhoto || '', residenceProofPhoto: userData.residenceProofPhoto || '',
        });
      }

      // Escrita atomica: doc publico + private/data num batch
      const batch = firestore().batch();
      batch.set(firestore().collection('users').doc(user.uid), publicData);
      batch.set(
        firestore().collection('users').doc(user.uid).collection('private').doc('data'),
        privateData
      );
      await batch.commit();

      return { success: true, user, needsVerification: true };
    } catch (error) {
      let msg = error.message;
      if (error.code === 'auth/email-already-in-use') msg = 'Este email ja esta em uso.';
      if (error.code === 'auth/invalid-email') msg = 'Email invalido.';
      if (error.code === 'auth/weak-password') msg = 'Senha muito fraca (minimo 6 caracteres).';
      return { success: false, error: msg };
    }
  },

  // ===== GOOGLE SIGN-IN =====
  configureGoogleSignIn: (webClientId) => {
    if (!GoogleSignin) return;
    GoogleSignin.configure({ webClientId });
  },

  signInWithGoogle: async () => {
    try {
      if (!GoogleSignin) return { success: false, error: 'Google Sign-In nao configurado.' };
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();
      let idToken = signInResult?.data?.idToken || signInResult?.idToken;
      if (!idToken) return { success: false, error: 'Nao foi possivel obter credencial do Google.' };

      const googleCredential = auth.GoogleAuthProvider.credential(idToken);
      const userCredential = await auth().signInWithCredential(googleCredential);
      const user = userCredential.user;

      const profileDoc = await firestore().collection('users').doc(user.uid).get();
      if (profileDoc.exists) {
        if (!profileDoc.data().emailVerified) {
          await firestore().collection('users').doc(user.uid).update({
            emailVerified: true, emailVerifiedAt: firestore.FieldValue.serverTimestamp(),
          });
        }
        return { success: true, user, isNewUser: false, needsProfile: false };
      }
      return { success: true, user, isNewUser: true, needsProfile: true };
    } catch (error) {
      if (error.code === 'SIGN_IN_CANCELLED' || error.code === '12501') return { success: false, error: 'Login cancelado.' };
      if (error.code === 'PLAY_SERVICES_NOT_AVAILABLE') return { success: false, error: 'Google Play Services nao disponivel.' };
      return { success: false, error: 'Erro ao fazer login com Google. Tente novamente.' };
    }
  },

  completeGoogleProfile: async (userId, userData) => {
    try {
      const user = auth().currentUser;

      // Verificar unicidade de CPF/CNPJ e telefone (Q1.8)
      if (userData.personType === 'pj' || userData.personType === 'mei') {
        if (userData.cnpj) {
          const cnpjCheck = await authService.checkDocumentExists(userData.cnpj, 'cnpj');
          if (cnpjCheck.exists) return { success: false, error: 'Este CNPJ ja esta cadastrado.' };
        }
      } else {
        if (userData.cpf) {
          const cpfCheck = await authService.checkCpfExists(userData.cpf);
          if (cpfCheck.exists) return { success: false, error: 'Este CPF ja esta cadastrado.' };
        }
      }
      if (userData.phone) {
        const phoneCheck = await authService.checkPhoneExists(userData.phone);
        if (phoneCheck.exists) return { success: false, error: 'Este numero ja esta cadastrado.' };
      }

      // Doc publico: dados de acesso, busca e autenticacao.
      // Fase A (Q1.2): phone ainda duplicado aqui para checkPhoneExists funcionar.
      // Batch 4 (Fase C): remover phone do publico apos migrar checkPhoneExists para admin SDK.
      const publicData = {
        email: user.email, name: userData.name || user.displayName || '',
        role: userData.role,
        emailVerified: true, emailVerifiedAt: firestore.FieldValue.serverTimestamp(),
        authProvider: 'google', googlePhotoUrl: user.photoURL || '',
        profilePhoto: userData.profilePhoto || null,
        cpf: userData.cpf || '', cnpj: userData.cnpj || '',
        phone: userData.phone || '',
        createdAt: firestore.FieldValue.serverTimestamp(),
      };

      // Private sub-doc: PII completo (phone, cpf, cnpj, endereco, dados pessoais, CNH)
      // cpf/cnpj ficam em ambos os docs na Fase A para checkCpfExists/login funcionar.
      const privateData = {
        phone: userData.phone || '',
        cpf: userData.cpf || '',
        cnpj: userData.cnpj || '',
        birthDate: userData.birthDate || '',
        personType: userData.personType || 'pf',
        companyName: userData.companyName || '',
        cep: userData.cep || '', street: userData.street || '', number: userData.number || '',
        complement: userData.complement || '', neighborhood: userData.neighborhood || '',
        city: userData.city || '', state: userData.state || '', address: userData.address || '',
      };

      // Campos exclusivos locatario no private
      if (userData.role === 'locatario') {
        Object.assign(privateData, {
          cnhNumber: userData.cnhNumber || '', cnhCategory: userData.cnhCategory || '',
          cnhExpiry: userData.cnhExpiry || '', cnhFrontPhoto: userData.cnhFrontPhoto || '',
          cnhBackPhoto: userData.cnhBackPhoto || '', residenceProofPhoto: userData.residenceProofPhoto || '',
        });
      }

      // Escrita atomica: doc publico + private/data num batch
      const batch = firestore().batch();
      batch.set(firestore().collection('users').doc(userId), publicData);
      batch.set(
        firestore().collection('users').doc(userId).collection('private').doc('data'),
        privateData
      );
      await batch.commit();

      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  },

  sendVerificationEmail: async () => {
    try {
      const user = auth().currentUser;
      if (!user) return { success: false, error: 'Usuario nao logado.' };
      if (user.emailVerified) return { success: true, alreadyVerified: true };
      await user.sendEmailVerification();
      return { success: true };
    } catch (error) {
      if (error.code === 'auth/too-many-requests') return { success: false, error: 'Muitos emails enviados. Aguarde.' };
      return { success: false, error: 'Erro ao enviar email.' };
    }
  },

  checkEmailVerified: async () => {
    try {
      const user = auth().currentUser;
      if (!user) return { verified: false };
      await user.reload();
      const refreshed = auth().currentUser;
      if (refreshed.emailVerified) {
        try { await firestore().collection('users').doc(refreshed.uid).update({ emailVerified: true, emailVerifiedAt: firestore.FieldValue.serverTimestamp() }); } catch (e) {}
        return { verified: true };
      }
      return { verified: false };
    } catch (error) { return { verified: false }; }
  },

  login: async (email, password) => {
    try {
      const r = await auth().signInWithEmailAndPassword(email.trim().toLowerCase(), password);
      return { success: true, user: r.user };
    } catch (error) {
      let msg = 'Email ou senha incorretos.';
      if (error.code === 'auth/too-many-requests') msg = 'Muitas tentativas. Aguarde.';
      if (error.code === 'auth/user-disabled') msg = 'Conta desativada.';
      return { success: false, error: msg };
    }
  },

  findEmailByCpf: async (cpf) => {
    try {
      const cleanCpf = cpf.replace(/\D/g, '');
      if (cleanCpf.length !== 11) return { success: false, error: 'CPF invalido.' };
      const snapshot = await firestore().collection('users').where('cpf', '==', cleanCpf).get();
      if (snapshot.empty) return { success: false, error: 'CPF ou senha incorretos.' };
      return { success: true, email: snapshot.docs[0].data().email };
    } catch (error) { return { success: false, error: 'Erro ao buscar usuario.' }; }
  },

  findEmailByIdentifier: async (identifier) => {
    try {
      const clean = identifier.replace(/\D/g, '');
      if (clean.length === 11) {
        const snapshot = await firestore().collection('users').where('cpf', '==', clean).get();
        if (snapshot.empty) return { success: false, error: 'CPF ou senha incorretos.' };
        return { success: true, email: snapshot.docs[0].data().email };
      } else if (clean.length === 14) {
        const snapshot = await firestore().collection('users').where('cnpj', '==', clean).get();
        if (snapshot.empty) return { success: false, error: 'CNPJ ou senha incorretos.' };
        return { success: true, email: snapshot.docs[0].data().email };
      }
      return { success: false, error: 'Identificador invalido.' };
    } catch (error) { return { success: false, error: 'Erro ao buscar usuario.' }; }
  },

  loginWithCpf: async (cpf, password) => {
    const r = await authService.findEmailByCpf(cpf);
    if (!r.success) return r;
    return authService.login(r.email, password);
  },

  loginWithIdentifier: async (identifier, password) => {
    const r = await authService.findEmailByIdentifier(identifier);
    if (!r.success) return r;
    return authService.login(r.email, password);
  },

  reauthenticateWithPassword: async (password) => {
    try {
      const user = auth().currentUser;
      if (!user) return { success: false, error: 'Usuario nao autenticado.' };
      const credential = auth.EmailAuthProvider.credential(user.email, password);
      await user.reauthenticateWithCredential(credential);
      return { success: true };
    } catch (error) {
      const msg = ['auth/wrong-password', 'auth/invalid-credential'].includes(error.code)
        ? 'Senha incorreta.'
        : 'Falha na reautenticacao. Tente novamente.';
      return { success: false, error: msg };
    }
  },

  reauthenticateWithGoogle: async () => {
    try {
      if (!GoogleSignin) return { success: false, error: 'Google Sign-In nao disponivel.' };
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken || userInfo.idToken;
      if (!idToken) return { success: false, error: 'Nao foi possivel obter token do Google.' };
      const googleCredential = auth.GoogleAuthProvider.credential(idToken);
      await auth().currentUser.reauthenticateWithCredential(googleCredential);
      return { success: true };
    } catch (error) {
      return { success: false, error: 'Falha na reautenticacao com Google.' };
    }
  },

  logout: async () => {
    try {
      // Limpar FCM token ANTES do signOut (enquanto request.auth ainda e valido)
      const uid = auth().currentUser?.uid;
      if (uid) {
        try {
          await firestore().collection('users').doc(uid).update({
            fcmToken: null,
            fcmTokenUpdatedAt: firestore.FieldValue.serverTimestamp(),
          });
        } catch (e) {}
      }
      if (GoogleSignin) { try { await GoogleSignin.signOut(); } catch (e) {} }
      await auth().signOut();
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  },

  getCurrentUserProfile: async (userId) => {
    try {
      const doc = await firestore().collection('users').doc(userId).get();
      if (!doc.exists) return { success: false, error: 'Profile not found' };

      // Merge com private/data (PII). Fallback gracioso se sub-doc nao existir ainda
      // (usuarios registrados antes do Q1.2 ainda tem PII no doc publico).
      // Filtrar undefined/null do private para nao sobrescrever valores validos do publico.
      const privateDoc = await firestore()
        .collection('users').doc(userId)
        .collection('private').doc('data').get();
      const rawPrivate = privateDoc.exists ? privateDoc.data() : {};
      const privateData = Object.fromEntries(
        Object.entries(rawPrivate).filter(([, v]) => v !== undefined && v !== null)
      );

      return { success: true, data: { id: doc.id, ...doc.data(), ...privateData } };
    } catch (error) { return { success: false, error: error.message }; }
  },

  getCurrentUser: () => auth().currentUser,
  onAuthStateChanged: (cb) => auth().onAuthStateChanged(cb),
};
