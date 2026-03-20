// src/services/navigationService.js
// Ref de navegacao global — permite navegar de fora de componentes React (ex: notificationService)
// Separado em arquivo proprio para evitar circular import entre App.tsx e notificationService.js
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();
